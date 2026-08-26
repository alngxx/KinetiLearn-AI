import asyncio
import uuid
from unittest.mock import AsyncMock, patch

from openai import OpenAIError
from sqlalchemy import create_engine, delete
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

import worker.tasks as tasks
from app.core.config import settings
from app.core.llm import GeneratedQuestion
from app.modules.classes.models import Class
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams import service
from app.modules.exams.models import Exercise, ExerciseDocument, ExerciseGenerationJob

# The worker runs on its own sync (psycopg2) session, so these tests follow the
# same approach as tests/documents/test_worker_activate.py and the daily quiz
# generation tests: point SyncSessionLocal at the test DB, seed rows, call the task
# directly, then clean up the committed rows.
sync_url = (
    make_url(settings.DATABASE_URL)
    .set(database = "KinetiLearn_test")
    .set(drivername = "postgresql+psycopg2")
)


def _sessionmaker():
    engine = create_engine(sync_url)
    return sessionmaker(bind = engine, expire_on_commit = False)


def _fake_questions(n, options = 4, correct_index = 1):
    return [
        GeneratedQuestion(
            question_text = f"Question {i}?",
            explanation = "Because the source says so.",
            options = [f"Option {j}" for j in range(options)],
            correct_index = correct_index,
        )
        for i in range(n)
    ]


def _seed_class(s):
    cls = Class(name = f"Class {uuid.uuid4()}")
    s.add(cls)
    s.flush()
    return cls.id


def _seed_document(s, *, num_chunks = 3, status = "ready"):
    doc_id = uuid.uuid4()
    s.add(Document(id = doc_id, title = f"Doc {doc_id}", active_version_number = 1))
    s.add(DocumentVersion(
        document_id = doc_id,
        version_number = 1,
        file_url = "documents/x/v1.pdf",
        file_name = "f.pdf",
        file_size_bytes = 10,
        mime_type = "application/pdf",
        processing_status = status,
    ))
    s.flush()
    for i in range(num_chunks):
        s.add(DocumentChunk(
            document_id = doc_id,
            version_number = 1,
            chunk_index = i,
            content = f"chunk {i} content",
        ))
    s.flush()
    return doc_id


def _seed_job(s, class_id, doc_ids, *, num_questions = 3, status = "queued"):
    job = ExerciseGenerationJob(
        class_id = class_id,
        title = "Quiz A",
        prompt = "Cover the basics",
        num_questions = num_questions,
        document_ids = [str(d) for d in doc_ids],
        status = status,
    )
    s.add(job)
    s.flush()
    return job.id


def _cleanup(Session, class_ids = (), doc_ids = ()):
    s = Session()
    for cid in class_ids:
        s.execute(
            delete(ExerciseGenerationJob).where(ExerciseGenerationJob.class_id == cid)
        )
        # Questions, options and exercise_documents cascade from the exercise.
        s.execute(delete(Exercise).where(Exercise.class_id == cid))
    s.commit()
    for did in doc_ids:
        s.execute(delete(DocumentChunk).where(DocumentChunk.document_id == did))
        s.execute(delete(DocumentVersion).where(DocumentVersion.document_id == did))
        s.execute(delete(Document).where(Document.id == did))
    for cid in class_ids:
        s.execute(delete(Class).where(Class.id == cid))
    s.commit()
    s.close()


async def test_generates_exercise_and_marks_the_job_succeeded(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 3)
    s.commit()
    s.close()

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(
                 service, "generate_quiz", AsyncMock(return_value = _fake_questions(3))
             ):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        assert job.status == "succeeded"
        assert job.exercise_id is not None
        assert job.questions_done == 3
        assert job.finished_at is not None
        assert job.error is None

        exercise = s2.get(Exercise, job.exercise_id)
        assert exercise.title == "Quiz A"
        assert exercise.is_active is False
        assert exercise.total_points == 3
        assert len(exercise.questions) == 3
        for q in exercise.questions:
            assert len(q.options) == 4
            assert sum(1 for o in q.options if o.is_correct) == 1
            # Single source -> every question is attributable to it.
            assert q.source_document_id == doc_id
            assert q.source_version_number == 1

        sources = s2.query(ExerciseDocument).filter_by(exercise_id = exercise.id).all()
        assert {(x.document_id, x.version_number) for x in sources} == {(doc_id, 1)}
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_multi_document_records_sources_and_leaves_provenance_null(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc1 = _seed_document(s)
    doc2 = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc1, doc2], num_questions = 2)
    s.commit()
    s.close()

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(
                 service, "generate_quiz", AsyncMock(return_value = _fake_questions(2))
             ):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        assert job.status == "succeeded"
        exercise = s2.get(Exercise, job.exercise_id)
        # Several sources -> per-question attribution isn't knowable.
        assert all(q.source_document_id is None for q in exercise.questions)
        sources = s2.query(ExerciseDocument).filter_by(exercise_id = exercise.id).all()
        assert {(x.document_id, x.version_number) for x in sources} == {
            (doc1, 1), (doc2, 1)
        }
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc1, doc2])


async def test_shuffles_the_correct_option(test_engine):
    import random

    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 20)
    s.commit()
    s.close()

    try:
        # Every correct_index is 0 — without shuffling every correct option would be
        # label "A". Seed the RNG so the assertion is deterministic.
        random.seed(0)
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(
                 service,
                 "generate_quiz",
                 AsyncMock(return_value = _fake_questions(20, correct_index = 0)),
             ):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        exercise = s2.get(Exercise, job.exercise_id)
        labels = []
        for q in exercise.questions:
            correct = [o for o in q.options if o.is_correct]
            assert len(correct) == 1
            # Shuffling must preserve WHICH option is correct, only move it.
            assert correct[0].option_text == "Option 0"
            labels.append(correct[0].option_label)
        assert len(set(labels)) > 1
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


# --------------------------------------------------------------------------
# Failure modes. Every one of these must leave zero exercise rows behind — the
# whole reason the exercise is written in a single commit at the end.
# --------------------------------------------------------------------------

async def _run_failing(Session, class_id, doc_ids, job_id, mock):
    with patch.object(tasks, "SyncSessionLocal", Session), \
         patch.object(service, "generate_quiz", mock):
        await asyncio.to_thread(tasks.generate_exercise, str(job_id))

    s2 = Session()
    job = s2.get(ExerciseGenerationJob, job_id)
    exercises = s2.query(Exercise).filter_by(class_id = class_id).count()
    result = (job.status, job.error, job.exercise_id, job.finished_at, exercises)
    s2.close()
    return result


async def test_wrong_question_count_fails_the_job_and_saves_nothing(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    # Asked for 3 but the generator returns 2 — reject the whole batch.
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 3)
    s.commit()
    s.close()

    try:
        status, error, exercise_id, finished_at, count = await _run_failing(
            Session, class_id, [doc_id], job_id,
            AsyncMock(return_value = _fake_questions(2)),
        )
        assert status == "failed"
        assert error == "Generator returned the wrong number of questions"
        assert exercise_id is None
        assert finished_at is not None
        assert count == 0
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_bad_correct_index_fails_the_job_and_saves_nothing(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 2)
    s.commit()
    s.close()

    try:
        status, error, exercise_id, _, count = await _run_failing(
            Session, class_id, [doc_id], job_id,
            AsyncMock(return_value = _fake_questions(2, correct_index = 9)),
        )
        assert status == "failed"
        assert error == "Generator returned an invalid question"
        assert exercise_id is None
        assert count == 0
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_llm_failure_keeps_the_endpoint_wording_and_saves_nothing(test_engine):
    # The real generate_quiz runs here, only the OpenAI client is stubbed: an SDK
    # error has to leave llm.py as an LLMError so the worker reports the same
    # wording the synchronous endpoint used to return, not a raw OpenAI message.
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 2)
    s.commit()
    s.close()

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch("app.core.llm._get_client") as get_client:
            get_client.return_value.chat.completions.parse = AsyncMock(
                side_effect = OpenAIError("tokens per min (TPM): Limit 30000")
            )
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        assert job.status == "failed"
        assert job.error == "Failed to generate questions"
        # The raw SDK message must not leak into something an admin reads.
        assert "TPM" not in job.error
        assert job.exercise_id is None
        assert s2.query(Exercise).filter_by(class_id = class_id).count() == 0
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


# --------------------------------------------------------------------------
# Redelivery. Celery can deliver the same message twice; the status guard is the
# only thing standing between one exercise and two. These assert the guard fired,
# not merely that the outcome looks right — "still one exercise" would also pass
# if some unrelated check happened to catch it.
# --------------------------------------------------------------------------

async def test_redelivery_after_success_returns_before_the_llm(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 3)
    s.commit()
    s.close()

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(
                 service, "generate_quiz", AsyncMock(return_value = _fake_questions(3))
             ):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        s2 = Session()
        first = s2.get(ExerciseGenerationJob, job_id)
        assert first.status == "succeeded"
        before = (
            first.status, first.questions_done, first.exercise_id, first.finished_at
        )
        s2.close()

        # Same message delivered again, with a fresh spy on the LLM call.
        spy = AsyncMock(return_value = _fake_questions(3))
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", spy):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        # The mechanism: execution never reached the LLM, which is the early
        # return on status and nothing else.
        assert spy.call_count == 0

        s3 = Session()
        second = s3.get(ExerciseGenerationJob, job_id)
        after = (
            second.status, second.questions_done, second.exercise_id,
            second.finished_at,
        )
        # finished_at in particular must not have moved — a second run that redid
        # the work and landed on the same result would restamp it.
        assert after == before
        assert s3.query(Exercise).filter_by(class_id = class_id).count() == 1
        s3.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_redelivery_while_running_returns_before_the_llm(test_engine):
    # The crash-mid-run case: a job left in 'running' by a killed worker must not
    # be picked up again and generate a second exercise.
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 3, status = "running")
    s.commit()
    s.close()

    try:
        spy = AsyncMock(return_value = _fake_questions(3))
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", spy):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        assert spy.call_count == 0

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        # Left exactly as it was — not failed, not restarted.
        assert job.status == "running"
        assert job.exercise_id is None
        assert s2.query(Exercise).filter_by(class_id = class_id).count() == 0
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_missing_job_is_a_no_op(test_engine):
    Session = _sessionmaker()
    spy = AsyncMock(return_value = _fake_questions(3))
    with patch.object(tasks, "SyncSessionLocal", Session), \
         patch.object(service, "generate_quiz", spy):
        await asyncio.to_thread(tasks.generate_exercise, str(uuid.uuid4()))
    assert spy.call_count == 0


# --------------------------------------------------------------------------
# Sources changing under a queued job. Safe delete guards exercise_documents,
# daily quiz configs and chat citations — but a job's document_ids are a JSONB
# payload behind no foreign key, so a source really can vanish between enqueue
# and run. The worker must fail readably rather than crash on a None row.
# --------------------------------------------------------------------------

async def test_deleted_source_fails_the_job_with_a_readable_error(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 2)
    s.commit()
    s.close()

    # The document is deleted in the window between enqueue and the worker run.
    s2 = Session()
    s2.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))
    s2.execute(delete(DocumentVersion).where(DocumentVersion.document_id == doc_id))
    s2.execute(delete(Document).where(Document.id == doc_id))
    s2.commit()
    s2.close()

    try:
        spy = AsyncMock(return_value = _fake_questions(2))
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", spy):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        # Never reached the LLM — no point spending a batch on absent material.
        assert spy.call_count == 0

        s3 = Session()
        job = s3.get(ExerciseGenerationJob, job_id)
        assert job.status == "failed"
        assert "Source document is unavailable" in job.error
        assert str(doc_id) in job.error
        # The bug this guards: without the None check the admin reads
        # "'NoneType' object has no attribute 'active_version_number'".
        assert "NoneType" not in job.error
        assert "AttributeError" not in job.error
        assert job.exercise_id is None
        assert s3.query(Exercise).filter_by(class_id = class_id).count() == 0
        s3.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_source_reprocessed_to_pending_fails_the_job(test_engine):
    # Softer variant: the document survives but its active version went back to
    # processing, so its chunks are no longer trustworthy material.
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 2)
    s.commit()
    s.close()

    s2 = Session()
    version = s2.get(DocumentVersion, (doc_id, 1))
    version.processing_status = "pending"
    s2.commit()
    s2.close()

    try:
        spy = AsyncMock(return_value = _fake_questions(2))
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", spy):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        assert spy.call_count == 0

        s3 = Session()
        job = s3.get(ExerciseGenerationJob, job_id)
        assert job.status == "failed"
        assert "active version is not ready" in job.error
        assert s3.query(Exercise).filter_by(class_id = class_id).count() == 0
        s3.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_progress_is_committed_and_visible_while_the_job_runs(test_engine):
    # The waiting page polls a different connection, so progress is only useful if
    # each step is committed — not merely pending in the worker's transaction.
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(s, class_id, [doc_id], num_questions = 25)
    s.commit()
    s.close()

    seen = []

    async def fake_generate(context, prompt, count, on_progress = None):
        for done in (10, 20, 25):
            on_progress(done)
            # Read through a separate session, which can only see committed rows.
            reader = Session()
            seen.append(reader.get(ExerciseGenerationJob, job_id).questions_done)
            reader.close()
        return _fake_questions(25)

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", fake_generate):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        assert seen == [10, 20, 25]

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        assert job.status == "succeeded"
        assert job.questions_done == 25
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


# --------------------------------------------------------------------------
# The neutral default prompt. The request path stores whatever the admin typed,
# so the substitution is made here, at the point the model is actually called.
# --------------------------------------------------------------------------

async def _prompt_reaching_the_model(Session, class_id, doc_id, job_id):
    spy = AsyncMock(return_value = _fake_questions(2))
    with patch.object(tasks, "SyncSessionLocal", Session), \
         patch.object(service, "generate_quiz", spy):
        await asyncio.to_thread(tasks.generate_exercise, str(job_id))
    return spy.await_args.args[1]


async def test_blank_prompts_are_replaced_with_the_neutral_default(test_engine):
    Session = _sessionmaker()
    for stored in ("", "   "):
        s = Session()
        class_id = _seed_class(s)
        doc_id = _seed_document(s)
        job = ExerciseGenerationJob(
            class_id = class_id,
            title = "Quiz A",
            prompt = stored,
            num_questions = 2,
            document_ids = [str(doc_id)],
        )
        s.add(job)
        s.commit()
        job_id = job.id
        s.close()

        try:
            # An empty instruction is replaced, never passed through as "" — the
            # model would otherwise get a dangling "Admin instructions:" line.
            sent = await _prompt_reaching_the_model(
                Session, class_id, doc_id, job_id
            )
            assert sent == "Cover the main points of the source material evenly."
        finally:
            _cleanup(Session, [class_id], [doc_id])


async def test_a_real_prompt_is_passed_through_untouched(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job = ExerciseGenerationJob(
        class_id = class_id,
        title = "Quiz A",
        prompt = "Focus on escalation",
        num_questions = 2,
        document_ids = [str(doc_id)],
    )
    s.add(job)
    s.commit()
    job_id = job.id
    s.close()

    try:
        sent = await _prompt_reaching_the_model(Session, class_id, doc_id, job_id)
        assert sent == "Focus on escalation"
    finally:
        _cleanup(Session, [class_id], [doc_id])
