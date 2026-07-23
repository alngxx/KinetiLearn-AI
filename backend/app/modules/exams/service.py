from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.crud import get_or_404
from app.core.llm import LLMError, generate_quiz
from app.modules.classes.models import Class
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import Exercise, Question, QuestionOption
from app.modules.exams.schemas import (
    ExerciseResponse,
    FinalizeExerciseRequest,
    OptionUpdate,
    QuestionOptionResponse,
    QuestionResponse,
    QuestionUpdate,
)

MAX_CONTEXT_CHUNKS = 120
OPTION_LABELS = "ABCDEFGHIJ"
QUESTION_POINTS = 1


class ExamService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate(
        self,
        *,
        title: str,
        class_id: UUID,
        document_id: UUID,
        num_questions: int,
        prompt: str,
        creator_id: UUID | None,
    ) -> ExerciseResponse:
        await get_or_404(self.db, Class, class_id, "Class not found")
        document = await get_or_404(self.db, Document, document_id, "Document not found")

        # Must use the document's ACTIVE version, and only if it finished processing.
        if document.active_version_number is None:
            raise HTTPException(
                status_code = 400, detail = "Document has no active version"
            )
        version = await self.db.get(
            DocumentVersion, (document_id, document.active_version_number)
        )
        if version is None or version.processing_status != "ready":
            raise HTTPException(
                status_code = 400, detail = "Document active version is not ready"
            )

        chunks_total = await self.db.scalar(
            select(func.count())
            .select_from(DocumentChunk)
            .where(
                DocumentChunk.document_id == document_id,
                DocumentChunk.version_number == document.active_version_number,
            )
        )
        result = await self.db.execute(
            select(DocumentChunk)
            .where(
                DocumentChunk.document_id == document_id,
                DocumentChunk.version_number == document.active_version_number,
            )
            .order_by(DocumentChunk.chunk_index)
            .limit(MAX_CONTEXT_CHUNKS)
        )
        chunks = result.scalars().all()
        if not chunks:
            raise HTTPException(
                status_code = 400, detail = "Document active version has no content"
            )

        context = "\n\n".join(c.content for c in chunks)
        try:
            generated = await generate_quiz(context, prompt, num_questions)
        except LLMError:
            raise HTTPException(
                status_code = 502, detail = "Failed to generate questions"
            )

        self._validate_batch(generated, num_questions)

        # Build the whole graph in memory and commit once — a partial exercise
        # would silently mislead downstream consumers (same rule as Task 20).
        exercise = Exercise(
            title = title,
            class_id = class_id,
            start_time = datetime.now(timezone.utc),
            end_time = datetime.now(timezone.utc) + timedelta(days = 1),
            duration_minutes = 60,
            pass_score = 0,
            total_points = len(generated) * QUESTION_POINTS,
            is_active = False,
            created_by = creator_id,
        )
        for order_index, gq in enumerate(generated):
            question = Question(
                source_document_id = document_id,
                source_version_number = document.active_version_number,
                question_text = gq.question_text,
                explanation = gq.explanation,
                points = QUESTION_POINTS,
                order_index = order_index,
            )
            for i, option_text in enumerate(gq.options):
                question.options.append(QuestionOption(
                    option_label = OPTION_LABELS[i],
                    option_text = option_text,
                    is_correct = (i == gq.correct_index),
                ))
            exercise.questions.append(question)

        self.db.add(exercise)
        await self.db.commit()

        exercise = await self._load_exercise(exercise.id)
        return _to_response(exercise, len(chunks), chunks_total)

    def _validate_batch(self, generated, num_questions: int) -> None:
        if len(generated) != num_questions:
            raise HTTPException(
                status_code = 502,
                detail = "Generator returned the wrong number of questions",
            )
        for gq in generated:
            if len(gq.options) < 2 or len(gq.options) > len(OPTION_LABELS):
                raise HTTPException(
                    status_code = 502, detail = "Generator returned an invalid question"
                )
            if not (0 <= gq.correct_index < len(gq.options)):
                raise HTTPException(
                    status_code = 502, detail = "Generator returned an invalid question"
                )

    async def _load_exercise(self, exercise_id: UUID) -> Exercise | None:
        result = await self.db.execute(
            select(Exercise)
            .where(Exercise.id == exercise_id)
            .options(selectinload(Exercise.questions).selectinload(Question.options))
        )
        return result.scalar_one_or_none()

    async def _load_question(self, question_id: UUID) -> Question:
        result = await self.db.execute(
            select(Question)
            .where(Question.id == question_id)
            .options(selectinload(Question.options))
        )
        question = result.scalar_one_or_none()
        if question is None:
            raise HTTPException(status_code = 404, detail = "Question not found")
        return question

    async def get_exercise(self, exercise_id: UUID) -> ExerciseResponse:
        exercise = await self._load_exercise(exercise_id)
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found")

        chunks_used = chunks_total = None
        if exercise.questions:
            q = exercise.questions[0]
            if q.source_document_id is not None:
                chunks_total = await self.db.scalar(
                    select(func.count())
                    .select_from(DocumentChunk)
                    .where(
                        DocumentChunk.document_id == q.source_document_id,
                        DocumentChunk.version_number == q.source_version_number,
                    )
                )
                chunks_used = min(chunks_total, MAX_CONTEXT_CHUNKS)
        return _to_response(exercise, chunks_used, chunks_total)

    async def update_question(
        self, question_id: UUID, data: QuestionUpdate
    ) -> QuestionResponse:
        question = await self._load_question(question_id)
        for field, value in data.model_dump(exclude_unset = True).items():
            setattr(question, field, value)
        await self.db.commit()
        question = await self._load_question(question_id)
        return _question_response(question)

    async def update_option(
        self, question_id: UUID, option_id: UUID, data: OptionUpdate
    ) -> QuestionResponse:
        question = await self._load_question(question_id)
        option = next((o for o in question.options if o.id == option_id), None)
        if option is None:
            raise HTTPException(status_code = 404, detail = "Option not found")

        if data.option_text is not None:
            option.option_text = data.option_text

        if data.is_correct is True:
            for o in question.options:
                o.is_correct = (o.id == option_id)
        elif data.is_correct is False and option.is_correct:
            correct_count = sum(1 for o in question.options if o.is_correct)
            if correct_count <= 1:
                raise HTTPException(
                    status_code = 400,
                    detail = "A question must have exactly one correct option",
                )
            option.is_correct = False

        await self.db.commit()
        question = await self._load_question(question_id)
        return _question_response(question)

    async def finalize(
        self, exercise_id: UUID, data: FinalizeExerciseRequest
    ) -> ExerciseResponse:
        exercise = await self._load_exercise(exercise_id)
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found")
        if exercise.is_active:
            raise HTTPException(
                status_code = 409, detail = "Exercise is already finalized"
            )
        if not exercise.questions:
            raise HTTPException(
                status_code = 400,
                detail = "Cannot finalize an exercise with no questions",
            )
        if data.start_time >= data.end_time:
            raise HTTPException(
                status_code = 400, detail = "start_time must be before end_time"
            )
        if data.duration_minutes <= 0:
            raise HTTPException(
                status_code = 400, detail = "duration_minutes must be greater than 0"
            )
        if data.pass_score < 0:
            raise HTTPException(
                status_code = 400, detail = "pass_score must be at least 0"
            )

        # Source of truth is the current questions, not the value stored at
        # generation time (update_question can change points without syncing it).
        total_points = sum(q.points for q in exercise.questions)
        if data.pass_score > total_points:
            raise HTTPException(
                status_code = 400, detail = "pass_score cannot exceed total_points"
            )

        exercise.start_time = data.start_time
        exercise.end_time = data.end_time
        exercise.duration_minutes = data.duration_minutes
        exercise.pass_score = data.pass_score
        exercise.total_points = total_points
        exercise.is_active = True
        await self.db.commit()

        return _to_response(exercise, None, None)


def _question_response(question: Question) -> QuestionResponse:
    return QuestionResponse(
        id = question.id,
        question_text = question.question_text,
        explanation = question.explanation,
        points = question.points,
        order_index = question.order_index,
        options = [
            QuestionOptionResponse.model_validate(o)
            for o in sorted(question.options, key = lambda o: o.option_label)
        ],
    )


def _to_response(
    exercise: Exercise, chunks_used: int | None, chunks_total: int | None
) -> ExerciseResponse:
    questions = sorted(exercise.questions, key = lambda q: q.order_index)
    return ExerciseResponse(
        id = exercise.id,
        title = exercise.title,
        class_id = exercise.class_id,
        is_active = exercise.is_active,
        total_points = exercise.total_points,
        questions = [_question_response(q) for q in questions],
        chunks_used = chunks_used,
        chunks_total = chunks_total,
    )
