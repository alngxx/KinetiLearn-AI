import asyncio
import logging
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import cast
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, selectinload

from app.core.crud import get_or_404
from app.core.llm import generate_quiz
from app.modules.auth.models import User
from app.modules.config.models import (
    Department,
    EmployeeLevel,
    JobPosition,
    SeniorityLevel,
)
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.quiz.models import (
    DailyQuiz,
    DailyQuizConfig,
    DailyQuizQuestion,
    DailyQuizQuestionOption,
    DailyQuizSubmission,
    DailyQuizSubmissionAnswer,
)
from app.modules.quiz.schemas import (
    DailyQuizConfigCreate,
    DailyQuizConfigResponse,
    DailyQuizConfigUpdate,
    DailyQuizOptionOut,
    DailyQuizQuestionOut,
    DailyQuizSubmissionAnswerResponse,
    DailyQuizSubmissionDetailResponse,
    DailyQuizSubmissionResponse,
    DailyQuizSubmitRequest,
    DailyQuizTodayResponse,
)
from app.modules.scoring.service import SkillScoringService

logger = logging.getLogger(__name__)

NOT_FOUND = "Daily quiz config not found."

# Each target column with the model it points at, so validation and the error
# message stay in one place.
TARGET_MODELS = {
    "target_department_id": (Department, "Department not found."),
    "target_seniority_id": (SeniorityLevel, "Seniority level not found."),
    "target_job_position_id": (JobPosition, "Job position not found."),
    "target_employee_level_id": (EmployeeLevel, "Employee level not found."),
}


class DailyQuizConfigService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _check_dates(self, start_date: date, end_date: date | None) -> None:
        # Mirrors the ck_daily_quiz_configs_end_date_after_start CHECK so a bad
        # range returns {"detail": ...} instead of a raw IntegrityError.
        if end_date is not None and end_date < start_date:
            raise HTTPException(
                status_code = 400, detail = "end_date must be on or after start_date."
            )

    def _check_timezone(self, timezone: str) -> None:
        # A typo would only surface later, as a scheduler that never fires.
        try:
            ZoneInfo(timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(status_code = 400, detail = "Unknown timezone.")

    async def _check_document(self, document_id: UUID) -> None:
        # Same eligibility rule the chatbot and exam generator use: a live
        # document with a promoted version that finished processing.
        document = await get_or_404(
            self.db, Document, document_id, "Document not found."
        )
        if not document.is_active:
            raise HTTPException(status_code = 400, detail = "Document is inactive.")
        if document.active_version_number is None:
            raise HTTPException(status_code = 400, detail = "Document is not ready.")

        version = await self.db.get(
            DocumentVersion, (document_id, document.active_version_number)
        )
        if version is None or version.processing_status != "ready":
            raise HTTPException(status_code = 400, detail = "Document is not ready.")

    async def _check_targets(self, data: dict) -> None:
        # The target columns are real FKs, so an unknown id would fail as a 500
        # at commit time instead of a clean 404.
        for field, (model, detail) in TARGET_MODELS.items():
            target_id = data.get(field)
            if target_id is None:
                continue
            result = await self.db.execute(select(model.id).where(model.id == target_id))
            if result.scalar_one_or_none() is None:
                raise HTTPException(status_code = 404, detail = detail)

    async def create(
        self, data: DailyQuizConfigCreate, creator_id: UUID | None
    ) -> DailyQuizConfigResponse:
        self._check_dates(data.start_date, data.end_date)
        self._check_timezone(data.timezone)
        await self._check_document(data.source_document_id)
        await self._check_targets(data.model_dump())

        row = DailyQuizConfig(**data.model_dump(), created_by = creator_id)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return DailyQuizConfigResponse.model_validate(row)

    async def get_all(
        self, include_inactive: bool = False
    ) -> list[DailyQuizConfigResponse]:
        stmt = select(DailyQuizConfig).order_by(DailyQuizConfig.created_at.desc())
        if not include_inactive:
            stmt = stmt.where(DailyQuizConfig.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [
            DailyQuizConfigResponse.model_validate(row)
            for row in result.scalars().all()
        ]

    async def get_by_id(self, config_id: UUID) -> DailyQuizConfigResponse:
        row = await get_or_404(self.db, DailyQuizConfig, config_id, NOT_FOUND)
        return DailyQuizConfigResponse.model_validate(row)

    async def update(
        self, config_id: UUID, data: DailyQuizConfigUpdate
    ) -> DailyQuizConfigResponse:
        row = await get_or_404(self.db, DailyQuizConfig, config_id, NOT_FOUND)
        update_data = data.model_dump(exclude_none = True)

        # Validate against the values the row will actually end up with.
        self._check_dates(
            cast(date, update_data.get("start_date", row.start_date)),
            update_data.get("end_date", row.end_date),
        )
        if "timezone" in update_data:
            self._check_timezone(update_data["timezone"])
        if "source_document_id" in update_data:
            await self._check_document(update_data["source_document_id"])
        await self._check_targets(update_data)

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return DailyQuizConfigResponse.model_validate(row)

    async def activate(self, config_id: UUID) -> DailyQuizConfigResponse:
        return await self._set_active(config_id, True)

    async def deactivate(self, config_id: UUID) -> DailyQuizConfigResponse:
        return await self._set_active(config_id, False)

    async def _set_active(
        self, config_id: UUID, is_active: bool
    ) -> DailyQuizConfigResponse:
        row = await get_or_404(self.db, DailyQuizConfig, config_id, NOT_FOUND)
        row.is_active = is_active
        await self.db.commit()
        await self.db.refresh(row)
        return DailyQuizConfigResponse.model_validate(row)


ALREADY_SUBMITTED = "You have already submitted this daily quiz."
QUIZ_NOT_FOUND = "Daily quiz not found."


# Nothing records who a quiz was generated for, so audience is recomputed from
# the config and the learner's current profile — someone who has since changed
# department is no longer eligible. This repeats count_matching_learners' filters
# rather than sharing them: that half runs on a sync session and stays separate.
def _user_matches_config(user: User, config: DailyQuizConfig) -> bool:
    if user.role != "learner" or not user.is_active:
        return False
    targets = (
        (config.target_department_id, user.department_id),
        (config.target_seniority_id, user.seniority_id),
        (config.target_job_position_id, user.job_position_id),
        (config.target_employee_level_id, user.employee_level_id),
    )
    return all(target is None or target == held for target, held in targets)


class DailyQuizSubmissionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # config must be eager-loaded with the quiz: it is a lazy relationship, and
    # touching it later on the async engine raises MissingGreenlet.
    def _with_relations(self, stmt):
        return stmt.options(
            selectinload(DailyQuiz.config),
            selectinload(DailyQuiz.questions).selectinload(DailyQuizQuestion.options),
        )

    async def _load_quiz(self, daily_quiz_id: UUID) -> DailyQuiz:
        result = await self.db.execute(
            self._with_relations(select(DailyQuiz).where(DailyQuiz.id == daily_quiz_id))
        )
        quiz = result.scalar_one_or_none()
        if quiz is None:
            raise HTTPException(status_code = 404, detail = QUIZ_NOT_FOUND)
        return quiz

    # Neither questions nor options declare an order_by, so sort here to keep
    # the order a learner sees stable between requests.
    def _questions_out(self, quiz: DailyQuiz) -> list[DailyQuizQuestionOut]:
        return [
            DailyQuizQuestionOut(
                id = question.id,
                question_text = question.question_text,
                order_index = question.order_index,
                options = [
                    DailyQuizOptionOut.model_validate(option)
                    for option in sorted(
                        question.options, key = lambda o: o.option_label
                    )
                ],
            )
            for question in sorted(quiz.questions, key = lambda q: q.order_index)
        ]

    async def get_today(self, user: User) -> list[DailyQuizTodayResponse]:
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
            self._with_relations(
                select(DailyQuiz)
                .where(DailyQuiz.expires_at > now)
                .order_by(DailyQuiz.quiz_date.desc())
            )
        )
        quizzes = [
            quiz for quiz in result.scalars().all()
            if _user_matches_config(user, quiz.config)
        ]
        if not quizzes:
            return []

        submitted = await self.db.execute(
            select(DailyQuizSubmission.daily_quiz_id).where(
                DailyQuizSubmission.user_id == user.id,
                DailyQuizSubmission.daily_quiz_id.in_([quiz.id for quiz in quizzes]),
            )
        )
        submitted_ids = set(submitted.scalars().all())

        return [
            DailyQuizTodayResponse(
                id = quiz.id,
                quiz_date = quiz.quiz_date,
                expires_at = quiz.expires_at,
                already_submitted = quiz.id in submitted_ids,
                questions = self._questions_out(quiz),
            )
            for quiz in quizzes
        ]

    async def submit(
        self, user: User, data: DailyQuizSubmitRequest
    ) -> DailyQuizSubmissionDetailResponse:
        quiz = await self._load_quiz(data.daily_quiz_id)

        # Eligibility is checked before anything else, so a learner outside the
        # audience learns nothing about the quiz beyond the fact that it exists.
        if not _user_matches_config(user, quiz.config):
            raise HTTPException(
                status_code = 403,
                detail = "This daily quiz is not available to you.",
            )

        existing = await self.db.scalar(
            select(DailyQuizSubmission.id).where(
                DailyQuizSubmission.daily_quiz_id == quiz.id,
                DailyQuizSubmission.user_id == user.id,
            )
        )
        if existing is not None:
            raise HTTPException(status_code = 400, detail = ALREADY_SUBMITTED)

        questions = {q.id: q for q in quiz.questions}
        selected = self._validate_answers(data, questions)

        now = datetime.now(timezone.utc)
        # Expiry only flags the row. A daily quiz has no grading deadline the
        # way an exam does, so a late answer is still worth recording.
        submission = DailyQuizSubmission(
            daily_quiz_id = quiz.id,
            user_id = user.id,
            submitted_at = now,
            is_late = now > quiz.expires_at,
        )

        # A row is stored for every question, so a skipped one is recorded as
        # answered-with-nothing rather than being missing from the record.
        # Appending to the relationship sets the FK on cascade, which keeps the
        # insert to a single statement — see the commit below.
        score = 0
        for question_id, question in questions.items():
            option = selected.get(question_id)
            is_correct = None if option is None else bool(option.is_correct)
            points = question.points if is_correct else 0
            score += points
            submission.answers.append(DailyQuizSubmissionAnswer(
                daily_quiz_question_id = question_id,
                selected_option_id = None if option is None else option.id,
                is_correct = is_correct,
                points_earned = points,
            ))
        submission.score = score

        self.db.add(submission)
        try:
            # Nothing is flushed before this point on purpose: the unique
            # constraint on (daily_quiz_id, user_id) raises as soon as the row
            # is written, so the whole write stays inside the guard.
            await self.db.commit()
        except IntegrityError:
            # Two submissions that both got past the check above. The constraint
            # is what actually enforces one attempt.
            await self.db.rollback()
            raise HTTPException(status_code = 400, detail = ALREADY_SUBMITTED)

        # Built before scoring runs: a rollback below expires every object in the
        # session, and reading an expired attribute on the async engine raises
        # MissingGreenlet.
        response = DailyQuizSubmissionDetailResponse(
            id = submission.id,
            daily_quiz_id = quiz.id,
            quiz_date = quiz.quiz_date,
            score = submission.score,
            is_late = submission.is_late,
            submitted_at = submission.submitted_at,
            answers = [
                DailyQuizSubmissionAnswerResponse.model_validate(a)
                for a in submission.answers
            ],
        )

        # Scoring is a second transaction: the submission is already committed, so
        # a failure here costs the skill rows, not the learner's answers. Logged
        # rather than raised for the same reason — the submission did succeed.
        try:
            await SkillScoringService(self.db).score_daily_quiz_submission(
                submission, questions
            )
            await self.db.commit()
        except Exception as e:
            await self.db.rollback()
            logger.exception(
                "Skill scoring failed for daily quiz submission %s: %s",
                submission.id, e,
            )

        return response

    def _validate_answers(self, data: DailyQuizSubmitRequest, questions: dict) -> dict:
        selected = {}
        for answer in data.answers:
            if answer.daily_quiz_question_id not in questions:
                raise HTTPException(
                    status_code = 400,
                    detail = "Answer references a question not in this quiz.",
                )
            if answer.daily_quiz_question_id in selected:
                raise HTTPException(
                    status_code = 400, detail = "Duplicate answer for a question."
                )
            option = None
            if answer.selected_option_id is not None:
                options = {
                    o.id: o for o in questions[answer.daily_quiz_question_id].options
                }
                option = options.get(answer.selected_option_id)
                if option is None:
                    raise HTTPException(
                        status_code = 400,
                        detail = "Selected option does not belong to the question.",
                    )
            selected[answer.daily_quiz_question_id] = option
        return selected

    async def get_history(self, user_id: UUID) -> list[DailyQuizSubmissionResponse]:
        result = await self.db.execute(
            select(DailyQuizSubmission)
            .where(DailyQuizSubmission.user_id == user_id)
            .options(selectinload(DailyQuizSubmission.daily_quiz))
            .order_by(DailyQuizSubmission.submitted_at.desc())
        )
        # quiz_date lives on the quiz, not the submission, so the response is
        # built field by field instead of straight off the row.
        return [
            DailyQuizSubmissionResponse(
                id = row.id,
                daily_quiz_id = row.daily_quiz_id,
                quiz_date = row.daily_quiz.quiz_date,
                score = row.score,
                is_late = row.is_late,
                submitted_at = row.submitted_at,
            )
            for row in result.scalars().all()
        ]


# ---------------------------------------------------------------------------
# Daily quiz generation (Task 29).
#
# Everything below runs in the Celery worker on a SYNC session, unlike the async
# service above. Kept in this module so all daily-quiz logic lives together, but
# the two halves share no state and must not call each other.
# ---------------------------------------------------------------------------

MAX_CONTEXT_CHUNKS = 120
OPTION_LABELS = "ABCDEFGHIJ"
QUESTION_POINTS = 1

_loop = None


def _run_async(coro):
    # One event loop for the life of the worker process. asyncio.run() would close
    # the loop after each call, which strands the cached AsyncOpenAI client's
    # connection pool on a dead loop and breaks every config after the first.
    # Created lazily so it belongs to the forked child, not the parent process.
    global _loop
    if _loop is None:
        _loop = asyncio.new_event_loop()
    return _loop.run_until_complete(coro)


@dataclass
class DueConfig:
    config: DailyQuizConfig
    quiz_date: date
    push_instant: datetime


def find_due_configs(session: Session, now_utc: datetime) -> list[DueConfig]:
    """Active configs whose push_time has passed today and have no quiz yet.

    now_utc is a parameter rather than read from the clock so tests can pick any
    instant. The rule is "past push_time and not generated" instead of a narrow
    time window, so a worker outage delays a quiz instead of losing it.
    """
    configs = session.execute(
        select(DailyQuizConfig).where(DailyQuizConfig.is_active.is_(True))
    ).scalars().all()

    due = []
    for config in configs:
        tz = ZoneInfo(config.timezone)
        local_now = now_utc.astimezone(tz)
        quiz_date = local_now.date()

        if quiz_date < config.start_date:
            continue
        if config.end_date is not None and quiz_date > config.end_date:
            continue
        if local_now.time() < config.push_time:
            continue

        exists = session.execute(
            select(DailyQuiz.id).where(
                DailyQuiz.config_id == config.id,
                DailyQuiz.quiz_date == quiz_date,
            )
        ).scalar_one_or_none()
        if exists is not None:
            continue

        push_instant = datetime.combine(quiz_date, config.push_time, tzinfo = tz)
        due.append(DueConfig(config, quiz_date, push_instant))
    return due


def count_matching_learners(session: Session, config: DailyQuizConfig) -> int:
    # Same AND-filter shape as the class bulk-add: every set target must match.
    # A config with no targets at all is company-wide.
    filters = []
    if config.target_department_id is not None:
        filters.append(User.department_id == config.target_department_id)
    if config.target_seniority_id is not None:
        filters.append(User.seniority_id == config.target_seniority_id)
    if config.target_job_position_id is not None:
        filters.append(User.job_position_id == config.target_job_position_id)
    if config.target_employee_level_id is not None:
        filters.append(User.employee_level_id == config.target_employee_level_id)

    return session.scalar(
        select(func.count())
        .select_from(User)
        .where(
            User.role == "learner",
            User.is_active.is_(True),
            *filters,
        )
    ) or 0


def _build_context(session: Session, config: DailyQuizConfig) -> tuple[str, int]:
    document = session.get(Document, config.source_document_id)
    if document is None or not document.is_active:
        raise ValueError("Source document is unavailable")
    if document.active_version_number is None:
        raise ValueError("Source document has no active version")

    version = session.get(
        DocumentVersion, (config.source_document_id, document.active_version_number)
    )
    if version is None or version.processing_status != "ready":
        raise ValueError("Source document active version is not ready")

    chunks = session.execute(
        select(DocumentChunk)
        .where(
            DocumentChunk.document_id == config.source_document_id,
            DocumentChunk.version_number == document.active_version_number,
        )
        .order_by(DocumentChunk.chunk_index)
        .limit(MAX_CONTEXT_CHUNKS)
    ).scalars().all()
    if not chunks:
        raise ValueError("Source document active version has no content")

    return "\n\n".join(c.content for c in chunks), document.active_version_number


def _validate_batch(generated, question_count: int) -> None:
    # Same checks the exam generator makes, but raised as ValueError — there is no
    # HTTP context in the worker to turn an HTTPException into a response.
    if len(generated) != question_count:
        raise ValueError("Generator returned the wrong number of questions")
    for gq in generated:
        if len(gq.options) < 2 or len(gq.options) > len(OPTION_LABELS):
            raise ValueError("Generator returned an unusable number of options")
        if not 0 <= gq.correct_index < len(gq.options):
            raise ValueError("Generator returned an out-of-range correct_index")


def generate_daily_quiz(session: Session, due: DueConfig) -> DailyQuiz:
    """Generate and persist one shared quiz for a config's quiz_date.

    daily_quizzes has no user_id and is unique on (config_id, quiz_date), so this
    is one quiz for the whole matched audience, not one per learner.
    """
    config = due.config
    context, version_number = _build_context(session, config)

    generated = _run_async(
        generate_quiz(context, config.prompt, config.question_count)
    )
    _validate_batch(generated, config.question_count)

    # expires_at counts from the scheduled push instant, not from now, so a late
    # catch-up run doesn't quietly extend the submission window.
    quiz = DailyQuiz(
        config_id = config.id,
        quiz_date = due.quiz_date,
        expires_at = due.push_instant + timedelta(hours = config.expiry_hours),
    )
    for order_index, gq in enumerate(generated):
        question = DailyQuizQuestion(
            source_document_id = config.source_document_id,
            source_version_number = version_number,
            question_text = gq.question_text,
            explanation = gq.explanation,
            points = QUESTION_POINTS,
            order_index = order_index,
        )
        # Shuffle the options so the correct answer isn't biased toward the
        # first position — the model tends to return correct_index = 0.
        order = list(range(len(gq.options)))
        random.shuffle(order)
        correct_pos = order.index(gq.correct_index)
        for i, src in enumerate(order):
            question.options.append(DailyQuizQuestionOption(
                option_label = OPTION_LABELS[i],
                option_text = gq.options[src],
                is_correct = (i == correct_pos),
            ))
        quiz.questions.append(question)

    # One commit for the whole graph — a quiz row with no questions would look
    # like a real quiz to every reader downstream.
    session.add(quiz)
    session.commit()
    return quiz
