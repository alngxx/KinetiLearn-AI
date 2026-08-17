from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import get_or_404
from app.modules.auth.models import User
from app.modules.config.models import Category, Skill
from app.modules.documents.models import DocumentSkill
from app.modules.scoring.models import SkillScore, SkillScoreHistory
from app.modules.scoring.schemas import SkillBreakdownItem


# Same boundaries the skills table documents on basic_max / intermediate_max.
def _level_for(score: int, skill: Skill) -> str:
    if score <= skill.basic_max:
        return "basic"
    if score <= skill.intermediate_max:
        return "intermediate"
    return "advanced"


class SkillScoringService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # Neither scoring method commits: the caller owns the transaction, so an exam
    # submission and its skill rows land together.
    async def score_exam_submission(
        self, submission, questions: dict, answers: list
    ) -> None:
        points = {}
        for answer in answers:
            document_id = questions[answer.question_id].source_document_id
            if document_id is None or answer.points_earned == 0:
                continue
            points[document_id] = points.get(document_id, 0) + answer.points_earned
        await self._apply(submission.user_id, points, "exam", submission.id)

    async def score_daily_quiz_submission(self, submission, questions: dict) -> None:
        points = {}
        for answer in submission.answers:
            document_id = questions[answer.daily_quiz_question_id].source_document_id
            if document_id is None or answer.points_earned == 0:
                continue
            points[document_id] = points.get(document_id, 0) + answer.points_earned
        await self._apply(submission.user_id, points, "daily_quiz", submission.id)

    # Returns (skill, delta) pairs. The skill row rides along with the join so the
    # level lookup below doesn't need a second query per skill.
    async def _skill_deltas(self, points_by_document: dict) -> list:
        # A question earns its full points for every skill its document is tagged
        # with. Splitting them would round a 1-point question down to nothing, and
        # each skill is scored against its own thresholds, so there is no total to
        # divide up.
        result = await self.db.execute(
            select(DocumentSkill.document_id, Skill)
            .join(Skill, Skill.id == DocumentSkill.skill_id)
            .where(DocumentSkill.document_id.in_(points_by_document))
        )
        deltas = {}
        for document_id, skill in result.all():
            _, total = deltas.get(skill.id, (None, 0))
            deltas[skill.id] = (skill, total + points_by_document[document_id])
        return list(deltas.values())

    async def _apply(
        self,
        user_id: UUID,
        points_by_document: dict,
        source_type: str,
        source_id: UUID,
    ) -> None:
        # A question whose document is untagged, or that has no provenance at all,
        # contributes nothing — an admin's missing tag must not fail a learner's
        # submission.
        if not points_by_document:
            return

        now = datetime.now(timezone.utc)
        for skill, delta in await self._skill_deltas(points_by_document):
            score = await self.db.get(SkillScore, (user_id, skill.id))
            if score is None:
                score = SkillScore(
                    user_id = user_id,
                    skill_id = skill.id,
                    cumulative_score = 0,
                )
                self.db.add(score)

            score.cumulative_score = score.cumulative_score + delta
            score.current_level = _level_for(score.cumulative_score, skill)
            score.last_updated_at = now

            history = SkillScoreHistory(
                user_id = user_id,
                skill_id = skill.id,
                score_delta = delta,
                source_type = source_type,
            )
            # One id in, one column out — the CHECK constraint on this table
            # requires exactly one of the two FKs, so they are never both set here.
            if source_type == "exam":
                history.submission_id = source_id
            else:
                history.daily_quiz_submission_id = source_id
            self.db.add(history)

        await self.db.flush()

    # Driven from skills, not skill_scores: a radar chart needs every active skill
    # as an axis, and an unscored skill is exactly the "weak" one worth showing.
    async def get_breakdown(self, user_id: UUID) -> list[SkillBreakdownItem]:
        await get_or_404(self.db, User, user_id, "User not found.")
        result = await self.db.execute(
            select(Skill, Category.name, SkillScore)
            .join(Category, Category.id == Skill.category_id)
            .outerjoin(
                SkillScore,
                (SkillScore.skill_id == Skill.id) & (SkillScore.user_id == user_id),
            )
            .where(Skill.is_active.is_(True))
            .order_by(Skill.name)
        )
        return [
            SkillBreakdownItem(
                skill_id = skill.id,
                skill_name = skill.name,
                category_id = skill.category_id,
                category_name = category_name,
                cumulative_score = 0 if score is None else score.cumulative_score,
                current_level = "basic" if score is None else score.current_level,
                basic_max = skill.basic_max,
                intermediate_max = skill.intermediate_max,
                last_updated_at = None if score is None else score.last_updated_at,
            )
            for skill, category_name, score in result.all()
        ]
