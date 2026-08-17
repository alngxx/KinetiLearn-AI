from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.classes.service import assert_class_member
from app.modules.exams.models import Exercise, Question
from app.modules.scoring.service import SkillScoringService
from app.modules.submissions.models import Submission, SubmissionAnswer
from app.modules.submissions.schemas import (
    ScoreUpdate,
    SubmissionDetailResponse,
    SubmissionResponse,
    SubmitRequest,
)


class SubmissionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _load_exercise(self, exercise_id: UUID) -> Exercise:
        result = await self.db.execute(
            select(Exercise)
            .where(Exercise.id == exercise_id)
            .options(selectinload(Exercise.questions).selectinload(Question.options))
        )
        exercise = result.scalar_one_or_none()
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found.")
        return exercise

    async def _load_submission(self, submission_id: UUID) -> Submission:
        result = await self.db.execute(
            select(Submission)
            .where(Submission.id == submission_id)
            .options(selectinload(Submission.answers))
        )
        submission = result.scalar_one_or_none()
        if submission is None:
            raise HTTPException(status_code = 404, detail = "Submission not found.")
        return submission

    async def submit(self, user_id: UUID, data: SubmitRequest) -> SubmissionDetailResponse:
        exercise = await self._load_exercise(data.exercise_id)

        # Membership is checked before any exercise state, so a non-member
        # learns nothing about the exercise beyond the fact that it exists.
        await assert_class_member(self.db, exercise.class_id, user_id)

        if not exercise.is_active:
            raise HTTPException(
                status_code = 400, detail = "Exercise is not finalized."
            )

        now = datetime.now(timezone.utc)
        if now < exercise.start_time:
            raise HTTPException(
                status_code = 400, detail = "Exercise has not started yet."
            )

        questions = {q.id: q for q in exercise.questions}
        selected = self._validate_answers(data, questions)

        next_attempt = await self.db.scalar(
            select(func.coalesce(func.max(Submission.attempt_number), 0) + 1).where(
                Submission.user_id == user_id,
                Submission.exercise_id == exercise.id,
            )
        )

        submission = Submission(
            user_id = user_id,
            exercise_id = exercise.id,
            attempt_number = next_attempt,
            submitted_at = now,
            is_late = now > exercise.end_time,
        )
        self.db.add(submission)
        # Flush (not commit) to get the id — the submission and its answers are
        # written in a single transaction below.
        await self.db.flush()

        # A row is stored for every question, so a skipped one is recorded as
        # answered-with-nothing rather than being missing from the record.
        answers = []
        score = 0
        for question_id, question in questions.items():
            option = selected.get(question_id)
            is_correct = None if option is None else bool(option.is_correct)
            points = question.points if is_correct else 0
            score += points
            answers.append(SubmissionAnswer(
                submission_id = submission.id,
                question_id = question_id,
                selected_option_id = None if option is None else option.id,
                is_correct = is_correct,
                points_earned = points,
            ))

        submission.score = score
        submission.is_passed = score >= exercise.pass_score
        self.db.add_all(answers)
        # Scored before the commit so the submission and its skill rows are one
        # transaction — no partially scored submission can survive a failure.
        await SkillScoringService(self.db).score_exam_submission(
            submission, questions, answers
        )
        await self.db.commit()

        return await self.get_detail_by_id(submission.id)

    def _validate_answers(self, data: SubmitRequest, questions: dict) -> dict:
        selected = {}
        for answer in data.answers:
            if answer.question_id not in questions:
                raise HTTPException(
                    status_code = 400,
                    detail = "Answer references a question not in this exercise.",
                )
            if answer.question_id in selected:
                raise HTTPException(
                    status_code = 400, detail = "Duplicate answer for a question."
                )
            option = None
            if answer.selected_option_id is not None:
                options = {o.id: o for o in questions[answer.question_id].options}
                option = options.get(answer.selected_option_id)
                if option is None:
                    raise HTTPException(
                        status_code = 400,
                        detail = "Selected option does not belong to the question.",
                    )
            selected[answer.question_id] = option
        return selected

    async def get_detail_by_id(self, submission_id: UUID) -> SubmissionDetailResponse:
        submission = await self._load_submission(submission_id)
        return SubmissionDetailResponse.model_validate(submission)

    async def get_detail(self, submission_id: UUID, user) -> SubmissionDetailResponse:
        submission = await self._load_submission(submission_id)
        if user.role != "admin" and submission.user_id != user.id:
            raise HTTPException(
                status_code = 403, detail = "You cannot view this submission."
            )
        return SubmissionDetailResponse.model_validate(submission)

    async def get_my(
        self, user_id: UUID, class_id: UUID | None = None
    ) -> list[SubmissionResponse]:
        stmt = select(Submission).where(Submission.user_id == user_id)
        if class_id is not None:
            stmt = stmt.join(Exercise).where(Exercise.class_id == class_id)
        stmt = stmt.order_by(Submission.created_at.desc())
        result = await self.db.execute(stmt)
        return [SubmissionResponse.model_validate(s) for s in result.scalars().all()]

    async def list_for_admin(
        self,
        class_id: UUID | None = None,
        user_id: UUID | None = None,
        exercise_id: UUID | None = None,
    ) -> list[SubmissionResponse]:
        stmt = select(Submission)
        if class_id is not None:
            stmt = stmt.join(Exercise).where(Exercise.class_id == class_id)
        if user_id is not None:
            stmt = stmt.where(Submission.user_id == user_id)
        if exercise_id is not None:
            stmt = stmt.where(Submission.exercise_id == exercise_id)
        stmt = stmt.order_by(Submission.created_at.desc())
        result = await self.db.execute(stmt)
        return [SubmissionResponse.model_validate(s) for s in result.scalars().all()]

    async def update_score(
        self, submission_id: UUID, data: ScoreUpdate
    ) -> SubmissionResponse:
        submission = await self._load_submission(submission_id)
        exercise = await self._load_exercise(submission.exercise_id)

        if data.score > exercise.total_points:
            raise HTTPException(
                status_code = 400, detail = "score cannot exceed total_points."
            )

        submission.score = data.score
        submission.is_passed = data.score >= exercise.pass_score
        await self.db.commit()
        await self.db.refresh(submission)
        return SubmissionResponse.model_validate(submission)
