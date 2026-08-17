import random
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.crud import get_or_404
from app.core.llm import LLMError, generate_quiz
from app.modules.classes.models import Class
from app.modules.classes.service import assert_class_member
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import (
    Exercise,
    ExerciseDocument,
    Question,
    QuestionOption,
)
from app.modules.exams.schemas import (
    ExerciseResponse,
    FinalizeExerciseRequest,
    LearnerExerciseDetail,
    OptionUpdate,
    QuestionOptionResponse,
    QuestionResponse,
    QuestionUpdate,
)

# Chunks are cut at CHUNK_TARGET_TOKENS = 500 (worker/processing.py), so this is a
# worst-case ceiling of ~25k prompt tokens. That has to leave room for the generated
# questions inside the account's per-minute token budget — the previous 120 allowed
# ~60k tokens in a single call, which a 30k TPM tier rejects outright with a 429.
# Raise it if the OpenAI plan allows a larger TPM.
MAX_CONTEXT_CHUNKS = 50
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
        document_ids: list[UUID],
        num_questions: int,
        prompt: str,
        creator_id: UUID | None,
    ) -> ExerciseResponse:
        await get_or_404(self.db, Class, class_id, "Class not found")

        # Dedupe while preserving order, then share the chunk budget across the
        # documents so the combined context still fits the model's window.
        unique_ids = list(dict.fromkeys(document_ids))
        per_doc_cap = max(1, MAX_CONTEXT_CHUNKS // len(unique_ids))

        context_parts = []
        chunks_used = 0
        chunks_total = 0
        sources = []
        for document_id in unique_ids:
            document = await get_or_404(
                self.db, Document, document_id, "Document not found"
            )
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

            total = await self.db.scalar(
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
                .limit(per_doc_cap)
            )
            chunks = result.scalars().all()
            if not chunks:
                raise HTTPException(
                    status_code = 400, detail = "Document active version has no content"
                )

            context_parts.append("\n\n".join(c.content for c in chunks))
            chunks_used += len(chunks)
            chunks_total += total
            sources.append((document_id, document.active_version_number))

        context = "\n\n".join(context_parts)
        try:
            generated = await generate_quiz(context, prompt, num_questions)
        except LLMError:
            raise HTTPException(
                status_code = 502, detail = "Failed to generate questions"
            )

        self._validate_batch(generated, num_questions)

        # With a single source we can attribute every question to it; with several
        # sources a per-question attribution isn't knowable from one LLM call.
        src_doc, src_ver = sources[0] if len(sources) == 1 else (None, None)

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
                source_document_id = src_doc,
                source_version_number = src_ver,
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
                question.options.append(QuestionOption(
                    option_label = OPTION_LABELS[i],
                    option_text = gq.options[src],
                    is_correct = (i == correct_pos),
                ))
            exercise.questions.append(question)

        # Recorded whether there is one source or ten — with several, this is the
        # only surviving link back to the material the questions came from.
        for document_id, version_number in sources:
            exercise.source_documents.append(ExerciseDocument(
                document_id = document_id,
                version_number = version_number,
            ))

        self.db.add(exercise)
        await self.db.commit()

        exercise = await self._load_exercise(exercise.id)
        return _to_response(exercise, chunks_used, chunks_total)

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
            .options(
                selectinload(Exercise.questions).selectinload(Question.options),
                selectinload(Exercise.source_documents),
            )
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

    # The guards and their messages mirror SubmissionService.submit exactly, so a
    # learner can never open an exam they would then be refused on submit.
    async def get_for_learner(
        self, exercise_id: UUID, user_id: UUID
    ) -> LearnerExerciseDetail:
        exercise = await self._load_exercise(exercise_id)
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found.")

        await assert_class_member(self.db, exercise.class_id, user_id)

        if not exercise.is_active:
            raise HTTPException(status_code = 400, detail = "Exercise is not finalized.")

        # Deliberately no end_time check: submit() accepts late answers and flags
        # them is_late, so blocking the read would strand that path.
        if datetime.now(timezone.utc) < exercise.start_time:
            raise HTTPException(
                status_code = 400, detail = "Exercise has not started yet."
            )

        # Validating off the ORM row is what drops is_correct and explanation —
        # the learner schemas simply have no field to put them in.
        detail = LearnerExerciseDetail.model_validate(exercise)
        detail.questions.sort(key = lambda q: q.order_index)
        for question in detail.questions:
            question.options.sort(key = lambda o: o.option_label)
        return detail

    async def get_exercise(self, exercise_id: UUID) -> ExerciseResponse:
        exercise = await self._load_exercise(exercise_id)
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found")

        # Read from the recorded sources rather than the first question's
        # provenance, which is null whenever more than one document fed generation.
        # The budget split mirrors generate() so the numbers match what it returned.
        sources = exercise.source_documents
        chunks_used = chunks_total = None
        if sources:
            per_doc_cap = max(1, MAX_CONTEXT_CHUNKS // len(sources))
            chunks_used = chunks_total = 0
            for source in sources:
                total = await self.db.scalar(
                    select(func.count())
                    .select_from(DocumentChunk)
                    .where(
                        DocumentChunk.document_id == source.document_id,
                        DocumentChunk.version_number == source.version_number,
                    )
                )
                chunks_used += min(total, per_doc_cap)
                chunks_total += total
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

    async def delete_exercise(self, exercise_id: UUID) -> dict:
        exercise = await self.db.get(Exercise, exercise_id)
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found")
        # Questions and options are removed by the FK ON DELETE CASCADE.
        await self.db.delete(exercise)
        await self.db.commit()
        return {"deleted": 1}

    async def delete_all(self, confirm: bool) -> dict:
        if not confirm:
            raise HTTPException(
                status_code = 400,
                detail = "Pass confirm=true to delete all exercises",
            )
        result = await self.db.execute(delete(Exercise))
        await self.db.commit()
        return {"deleted": result.rowcount}


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
        description = exercise.description,
        class_id = exercise.class_id,
        is_active = exercise.is_active,
        start_time = exercise.start_time,
        end_time = exercise.end_time,
        duration_minutes = exercise.duration_minutes,
        pass_score = exercise.pass_score,
        total_points = exercise.total_points,
        questions = [_question_response(q) for q in questions],
        chunks_used = chunks_used,
        chunks_total = chunks_total,
    )
