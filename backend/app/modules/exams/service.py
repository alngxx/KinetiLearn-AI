import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, selectinload

from app.core.crud import assert_no_dependents, get_or_404
from app.core.llm import LLMError, generate_quiz
from app.modules.classes.models import Class
from app.modules.classes.service import assert_class_member
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import (
    Exercise,
    ExerciseDocument,
    ExerciseGenerationJob,
    Question,
    QuestionOption,
)
from app.modules.exams.schemas import (
    ExerciseResponse,
    GenerationJobResponse,
    ExerciseUpdate,
    FinalizeExerciseRequest,
    LearnerExerciseDetail,
    OptionUpdate,
    QuestionOptionResponse,
    QuestionResponse,
    QuestionUpdate,
)
from app.modules.submissions.models import Submission

logger = logging.getLogger(__name__)

# Chunks are cut at CHUNK_TARGET_TOKENS = 500 (worker/processing.py), so this is a
# worst-case ceiling of ~25k prompt tokens. That has to leave room for the generated
# questions inside the account's per-minute token budget — the previous 120 allowed
# ~60k tokens in a single call, which a 30k TPM tier rejects outright with a 429.
# Raise it if the OpenAI plan allows a larger TPM.
MAX_CONTEXT_CHUNKS = 50
OPTION_LABELS = "ABCDEFGHIJ"
QUESTION_POINTS = 1

# Used when the admin gives no instructions. The system prompt already pins the
# format and the source material is the only allowed subject, so the admin
# prompt only ever steers emphasis — with nothing to steer toward, ask for even
# coverage rather than sending the model an empty "Admin instructions:" line.
DEFAULT_PROMPT = "Cover the main points of the source material evenly."


class ExamService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def start_generation(
        self,
        *,
        title: str,
        class_id: UUID,
        document_ids: list[UUID],
        num_questions: int,
        prompt: str,
        creator_id: UUID | None,
    ) -> GenerationJobResponse:
        """Validate the request, record a job, and hand it to the worker.

        The LLM call and the persist moved to run_generation_job below — an admin no
        longer waits on a blocking request. The eligibility checks stay here so bad
        input still fails immediately, with the same messages it always did.
        """
        await get_or_404(self.db, Class, class_id, "Class not found")

        # Dedupe while preserving order. The chunk budget is shared across the
        # documents at run time; here we only check each one is usable.
        unique_ids = list(dict.fromkeys(document_ids))
        for document_id in unique_ids:
            await self._assert_document_usable(document_id)

        # Stored as strings: the column is JSONB, and Celery would serialise them
        # this way regardless.
        job = ExerciseGenerationJob(
            class_id = class_id,
            title = title,
            prompt = prompt,
            num_questions = num_questions,
            document_ids = [str(document_id) for document_id in unique_ids],
            created_by = creator_id,
        )
        self.db.add(job)
        await self.db.commit()
        await self.db.refresh(job)

        # Only after the job row is committed, so a broker outage can be recorded
        # against a row that already exists.
        await self._enqueue_generation(job)
        return GenerationJobResponse.model_validate(job)

    async def _assert_document_usable(self, document_id: UUID) -> None:
        # Must use the document's ACTIVE version, and only if it finished processing.
        document = await get_or_404(
            self.db, Document, document_id, "Document not found"
        )
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
        # Counted rather than loaded: the request path only needs to know there is
        # content, and the worker is what actually reads it.
        chunk_count = await self.db.scalar(
            select(func.count())
            .select_from(DocumentChunk)
            .where(
                DocumentChunk.document_id == document_id,
                DocumentChunk.version_number == document.active_version_number,
            )
        )
        if not chunk_count:
            raise HTTPException(
                status_code = 400, detail = "Document active version has no content"
            )

    async def _enqueue_generation(self, job: ExerciseGenerationJob) -> None:
        # Local import so the web app doesn't pull Celery at startup and to avoid
        # an import cycle with the worker package.
        from worker.tasks import generate_exercise

        try:
            generate_exercise.delay(str(job.id))
        except Exception:
            # Unlike a document version, which stays "pending" and can be retried
            # through reprocess_version, nothing would ever pick this job up again.
            # Fail it now rather than leave the admin watching a queue that will
            # never move.
            logger.exception("Failed to enqueue generation for job %s", job.id)
            job.status = "failed"
            job.error = "Could not queue generation. Try again."
            job.finished_at = datetime.now(timezone.utc)
            await self.db.commit()
            await self.db.refresh(job)

    async def get_job(self, job_id: UUID) -> GenerationJobResponse:
        job = await self.db.get(ExerciseGenerationJob, job_id)
        if job is None:
            raise HTTPException(status_code = 404, detail = "Generation job not found")
        return GenerationJobResponse.model_validate(job)

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
            .options(selectinload(Question.options), selectinload(Question.exercise))
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
        # Same rule update_exercise follows: once learners can see it, its
        # content stops being the admin's to change.
        if question.exercise.is_active:
            raise HTTPException(
                status_code = 409, detail = "Cannot edit a finalized exercise"
            )
        for field, value in data.model_dump(exclude_unset = True).items():
            setattr(question, field, value)
        await self.db.commit()
        question = await self._load_question(question_id)
        return _question_response(question)

    async def update_option(
        self, question_id: UUID, option_id: UUID, data: OptionUpdate
    ) -> QuestionResponse:
        question = await self._load_question(question_id)
        if question.exercise.is_active:
            raise HTTPException(
                status_code = 409, detail = "Cannot edit a finalized exercise"
            )
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

    async def update_exercise(
        self, exercise_id: UUID, data: ExerciseUpdate
    ) -> ExerciseResponse:
        exercise = await self._load_exercise(exercise_id)
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found")
        # Same rule the question edits follow: once learners can see it, its
        # wording stops being the admin's to change.
        if exercise.is_active:
            raise HTTPException(
                status_code = 409, detail = "Cannot edit a finalized exercise"
            )

        exercise.title = data.title
        await self.db.commit()
        return _to_response(exercise, None, None)

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

    async def unpublish(self, exercise_id: UUID) -> ExerciseResponse:
        exercise = await self._load_exercise(exercise_id)
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found")
        if not exercise.is_active:
            raise HTTPException(status_code = 409, detail = "Exercise is already a draft")

        # A submission row is only written at final submit (SubmissionService.submit),
        # so zero of them does not mean nobody is part-way through — get_for_learner
        # is a pure read with no row of its own. Before start_time it refuses outright
        # (same comparison as line 229 below), which is the only point at which nobody
        # can possibly have the exam open.
        await assert_no_dependents(
            self.db,
            select(Submission.id).where(Submission.exercise_id == exercise_id),
            "Cannot unpublish an exercise that has submissions.",
        )
        if datetime.now(timezone.utc) >= exercise.start_time:
            raise HTTPException(
                status_code = 409,
                detail = "Cannot unpublish an exercise that has already opened to learners.",
            )

        # Schedule is left exactly as finalize set it, so a re-finalize is a
        # re-confirm rather than starting from scratch.
        exercise.is_active = False
        await self.db.commit()

        return _to_response(exercise, None, None)

    async def delete_exercise(self, exercise_id: UUID) -> dict:
        exercise = await self.db.get(Exercise, exercise_id)
        if exercise is None:
            raise HTTPException(status_code = 404, detail = "Exercise not found")
        # submissions.exercise_id is RESTRICT, so without this the delete comes
        # back as a raw 500 instead of {"detail": ...}.
        await assert_no_dependents(
            self.db,
            select(Submission.id).where(Submission.exercise_id == exercise_id),
            "Cannot delete an exercise that has submissions.",
        )
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
        # Same RESTRICT FK as delete_exercise — any submission at all blocks the
        # bulk delete, since it would otherwise abort halfway as a 500.
        await assert_no_dependents(
            self.db,
            select(Submission.id),
            "Cannot delete exercises that have submissions.",
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


# ---------------------------------------------------------------------------
# Exam generation in the worker.
#
# Everything below runs in the Celery worker on a SYNC session, unlike the async
# service above. Same split the daily quiz module makes in quiz/service.py: the
# two halves share no state and must not call each other.
# ---------------------------------------------------------------------------

_loop = None


def _run_async(coro):
    # One event loop for the life of the worker process. asyncio.run() would close
    # the loop after each call, which strands the cached AsyncOpenAI client's
    # connection pool on a dead loop and breaks every job after the first.
    # Created lazily so it belongs to the forked child, not the parent process.
    global _loop
    if _loop is None:
        _loop = asyncio.new_event_loop()
    return _loop.run_until_complete(coro)


def _build_context(
    session: Session, document_ids: list[UUID]
) -> tuple[str, list[tuple[UUID, int]]]:
    """Re-read every source at run time and build the prompt context.

    Deliberately re-checks what start_generation already validated. A document can
    be deleted, or its active version reprocessed, in the window between enqueue and
    here — and nothing guards a job's document_ids, which are a JSONB payload rather
    than foreign keys. Raises ValueError so the caller turns it into a readable job
    error instead of an AttributeError on a None row.
    """
    per_doc_cap = max(1, MAX_CONTEXT_CHUNKS // len(document_ids))
    context_parts = []
    sources = []
    for document_id in document_ids:
        document = session.get(Document, document_id)
        if document is None:
            raise ValueError(f"Source document is unavailable ({document_id})")
        if document.active_version_number is None:
            raise ValueError(
                f"Source document has no active version ({document.title})"
            )

        version = session.get(
            DocumentVersion, (document_id, document.active_version_number)
        )
        if version is None or version.processing_status != "ready":
            raise ValueError(
                f"Source document active version is not ready ({document.title})"
            )

        chunks = session.execute(
            select(DocumentChunk)
            .where(
                DocumentChunk.document_id == document_id,
                DocumentChunk.version_number == document.active_version_number,
            )
            .order_by(DocumentChunk.chunk_index)
            .limit(per_doc_cap)
        ).scalars().all()
        if not chunks:
            raise ValueError(
                f"Source document active version has no content ({document.title})"
            )

        context_parts.append("\n\n".join(c.content for c in chunks))
        sources.append((document_id, document.active_version_number))

    return "\n\n".join(context_parts), sources


def _validate_generated(generated, num_questions: int) -> None:
    # Same checks the request path used to make, but raised as ValueError — there is
    # no HTTP context in the worker to turn an HTTPException into a response.
    if len(generated) != num_questions:
        raise ValueError("Generator returned the wrong number of questions")
    for gq in generated:
        if len(gq.options) < 2 or len(gq.options) > len(OPTION_LABELS):
            raise ValueError("Generator returned an invalid question")
        if not (0 <= gq.correct_index < len(gq.options)):
            raise ValueError("Generator returned an invalid question")


def _build_exercise(
    job: ExerciseGenerationJob, generated, sources: list[tuple[UUID, int]]
) -> Exercise:
    # With a single source we can attribute every question to it; with several
    # sources a per-question attribution isn't knowable from one LLM call.
    src_doc, src_ver = sources[0] if len(sources) == 1 else (None, None)

    exercise = Exercise(
        title = job.title,
        class_id = job.class_id,
        start_time = datetime.now(timezone.utc),
        end_time = datetime.now(timezone.utc) + timedelta(days = 1),
        duration_minutes = 60,
        pass_score = 0,
        total_points = len(generated) * QUESTION_POINTS,
        is_active = False,
        created_by = job.created_by,
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
    return exercise


def run_generation_job(session: Session, job_id: UUID) -> None:
    """Generate one exercise for a queued job. Entry point for the Celery task."""
    job = session.get(ExerciseGenerationJob, job_id)
    if job is None:
        return

    # Re-entry guard: a redelivered Celery message must not generate a second
    # exercise for a job that has already run, or is running right now.
    if job.status != "queued":
        logger.warning(
            "Skipping generation job %s: status is already %s", job_id, job.status
        )
        return

    job.status = "running"
    job.progress_at = datetime.now(timezone.utc)
    session.commit()

    try:
        document_ids = [UUID(str(d)) for d in job.document_ids]
        context, sources = _build_context(session, document_ids)
        instructions = job.prompt.strip() or DEFAULT_PROMPT

        def report(done: int) -> None:
            # Committed on its own so the waiting page can see progress before the
            # exercise itself lands. Nothing else is written yet, so there is no
            # partial exercise for this commit to expose.
            job.questions_done = done
            # Stamped every batch even when the count did not move (a batch of
            # pure duplicates): this measures that the worker is alive, which is
            # what the stale-job sweep needs to know.
            job.progress_at = datetime.now(timezone.utc)
            session.commit()

        generated = _run_async(
            generate_quiz(
                context, instructions, job.num_questions, on_progress = report
            )
        )
        _validate_generated(generated, job.num_questions)

        exercise = _build_exercise(job, generated, sources)
        session.add(exercise)
        session.flush()

        # Conditional on the job still being "running": the stale-job sweep may
        # have given up on this run and told the admin it failed. Committing an
        # exercise after that would contradict the "nothing was saved" the failure
        # panel promises, and leave a stray draft on the class page. Matching zero
        # rows rolls the exercise back with it, since both ride this transaction.
        claimed = session.execute(
            update(ExerciseGenerationJob)
            .where(
                ExerciseGenerationJob.id == job_id,
                ExerciseGenerationJob.status == "running",
            )
            .values(
                status = "succeeded",
                exercise_id = exercise.id,
                questions_done = job.num_questions,
                finished_at = datetime.now(timezone.utc),
            )
        )
        if claimed.rowcount == 0:
            session.rollback()
            logger.warning(
                "Discarding generation job %s: it is no longer running, so the "
                "stale-job sweep already failed it.", job_id
            )
            return
        # One commit lands the whole exercise graph and the job's success together:
        # a succeeded job pointing at no exercise would mislead every reader, and a
        # half-written exercise is the thing this design exists to prevent.
        session.commit()
    except Exception as e:
        # Nothing was committed inside the try except progress, so the rollback
        # discards the entire exercise graph — a failed job leaves no rows behind.
        session.rollback()
        logger.exception("Generation job %s failed: %s", job_id, e)
        # The raw OpenAI message can be long and leaky, so an LLM failure keeps the
        # wording the synchronous endpoint used to return.
        message = "Failed to generate questions" if isinstance(e, LLMError) else str(e)
        current = session.get(ExerciseGenerationJob, job_id)
        if current is not None:
            current.status = "failed"
            current.error = message
            current.finished_at = datetime.now(timezone.utc)
            session.commit()
