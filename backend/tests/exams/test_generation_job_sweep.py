import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine, delete
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

import worker.tasks as tasks
from app.core.config import settings
from app.modules.classes.models import Class
from app.modules.exams import service
from app.modules.exams.models import Exercise, ExerciseGenerationJob
from tests.exams.test_exam_generation_worker import (
    _fake_questions,
    _seed_class,
    _seed_document,
)

# Same sync-session approach as the other worker suites: the sweep runs on
# SyncSessionLocal, so it cannot use the async savepoint fixture.
sync_url = (
    make_url(settings.DATABASE_URL)
    .set(database = "KinetiLearn_test")
    .set(drivername = "postgresql+psycopg2")
)


def _sessionmaker():
    engine = create_engine(sync_url)
    return sessionmaker(bind = engine, expire_on_commit = False)


def _ago(minutes):
    return datetime.now(timezone.utc) - timedelta(minutes = minutes)


def _seed_job(s, class_id, doc_ids, *, status, created_ago, progress_ago = None,
              questions_done = 0, num_questions = 10):
    job = ExerciseGenerationJob(
        class_id = class_id,
        title = "Sweep subject",
        prompt = "x",
        num_questions = num_questions,
        document_ids = [str(d) for d in doc_ids],
        status = status,
        questions_done = questions_done,
        created_at = _ago(created_ago),
        progress_at = None if progress_ago is None else _ago(progress_ago),
    )
    s.add(job)
    s.flush()
    return job.id


def _cleanup(Session, class_ids = (), doc_ids = ()):
    from app.modules.documents.models import Document, DocumentChunk, DocumentVersion

    s = Session()
    for cid in class_ids:
        s.execute(
            delete(ExerciseGenerationJob).where(ExerciseGenerationJob.class_id == cid)
        )
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


async def _sweep(Session):
    with patch.object(tasks, "SyncSessionLocal", Session):
        return await asyncio.to_thread(tasks.sweep_stale_generation_jobs)


async def test_queued_past_threshold_is_failed_as_unclaimed(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(
        s, class_id, [doc_id], status = "queued",
        created_ago = tasks.QUEUED_TIMEOUT_MINUTES + 1,
    )
    s.commit()
    s.close()

    try:
        summary = await _sweep(Session)
        assert summary["queued"] == [str(job_id)]
        assert summary["stalled"] == []

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        assert job.status == "failed"
        assert job.finished_at is not None
        # The message must point at the actual fault: nothing ever claimed it.
        assert "No worker picked this up" in job.error
        assert "worker is running" in job.error
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_queued_within_threshold_is_left_alone(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(
        s, class_id, [doc_id], status = "queued",
        created_ago = tasks.QUEUED_TIMEOUT_MINUTES - 1,
    )
    s.commit()
    s.close()

    try:
        summary = await _sweep(Session)
        assert summary == {"queued": [], "stalled": []}

        s2 = Session()
        assert s2.get(ExerciseGenerationJob, job_id).status == "queued"
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_running_job_making_progress_is_untouched(test_engine):
    # Old job, but a batch landed a minute ago — slow is not stalled, and this is
    # exactly what measuring from progress_at instead of created_at buys.
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(
        s, class_id, [doc_id], status = "running",
        created_ago = 240, progress_ago = 1,
        questions_done = 30, num_questions = 50,
    )
    s.commit()
    s.close()

    try:
        summary = await _sweep(Session)
        assert summary == {"queued": [], "stalled": []}

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        assert job.status == "running"
        assert job.error is None
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_running_job_stalled_past_threshold_is_failed(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(
        s, class_id, [doc_id], status = "running",
        created_ago = 120, progress_ago = tasks.RUNNING_STALL_MINUTES + 1,
        questions_done = 20, num_questions = 50,
    )
    s.commit()
    s.close()

    try:
        summary = await _sweep(Session)
        assert summary["stalled"] == [str(job_id)]
        assert summary["queued"] == []

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        assert job.status == "failed"
        # Distinct from the unclaimed message, and says how far it got.
        assert "stopped responding after 20 of 50" in job.error
        assert "No worker picked this up" not in job.error
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_running_job_with_no_heartbeat_falls_back_to_created_at(test_engine):
    # Killed before its first batch ever landed, so progress_at is NULL. The
    # COALESCE is what keeps such a job reachable instead of stuck forever.
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(
        s, class_id, [doc_id], status = "running",
        created_ago = tasks.RUNNING_STALL_MINUTES + 1, progress_ago = None,
    )
    s.commit()
    s.close()

    try:
        summary = await _sweep(Session)
        assert summary["stalled"] == [str(job_id)]

        s2 = Session()
        assert s2.get(ExerciseGenerationJob, job_id).status == "failed"
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_sweep_never_touches_settled_jobs(test_engine):
    # Both are far older than either threshold; neither may be rewritten.
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    done_id = _seed_job(
        s, class_id, [doc_id], status = "succeeded",
        created_ago = 600, progress_ago = 600, questions_done = 10,
    )
    failed_id = _seed_job(
        s, class_id, [doc_id], status = "failed", created_ago = 600,
    )
    s.commit()
    s2 = Session()
    already = s2.get(ExerciseGenerationJob, failed_id)
    already.error = "Failed to generate questions"
    already.finished_at = _ago(600)
    s2.commit()
    original_finished = already.finished_at
    s2.close()
    s.close()

    try:
        summary = await _sweep(Session)
        assert summary == {"queued": [], "stalled": []}

        s3 = Session()
        done = s3.get(ExerciseGenerationJob, done_id)
        assert done.status == "succeeded"
        assert done.error is None

        failed = s3.get(ExerciseGenerationJob, failed_id)
        assert failed.status == "failed"
        # The original diagnosis survives — the sweep must not overwrite it with
        # a timeout message that would misreport why the run failed.
        assert failed.error == "Failed to generate questions"
        assert failed.finished_at == original_finished
        s3.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_sweep_reports_both_faults_in_one_pass(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    queued_id = _seed_job(
        s, class_id, [doc_id], status = "queued",
        created_ago = tasks.QUEUED_TIMEOUT_MINUTES + 5,
    )
    stalled_id = _seed_job(
        s, class_id, [doc_id], status = "running",
        created_ago = 200, progress_ago = tasks.RUNNING_STALL_MINUTES + 5,
    )
    healthy_id = _seed_job(
        s, class_id, [doc_id], status = "running",
        created_ago = 200, progress_ago = 2,
    )
    s.commit()
    s.close()

    try:
        summary = await _sweep(Session)
        assert summary["queued"] == [str(queued_id)]
        assert summary["stalled"] == [str(stalled_id)]

        s2 = Session()
        assert s2.get(ExerciseGenerationJob, healthy_id).status == "running"
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


# The race the sweep creates: it gives up on a run that is in fact still alive,
# then that worker finishes. Committing the exercise anyway would contradict the
# "Nothing was saved" the failure panel shows the admin, and strand a draft on
# the class page nobody expects.
async def test_worker_finishing_after_a_sweep_leaves_no_stray_draft(test_engine):
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(
        s, class_id, [doc_id], status = "queued", created_ago = 0, num_questions = 2,
    )
    s.commit()
    s.close()

    async def sweep_mid_run(context, prompt, count, on_progress = None):
        # The sweep fires while this batch is in flight and fails the job.
        sweeper = Session()
        job = sweeper.get(ExerciseGenerationJob, job_id)
        job.status = "failed"
        job.error = "Generation stopped responding"
        job.finished_at = datetime.now(timezone.utc)
        sweeper.commit()
        sweeper.close()
        return _fake_questions(2)

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", sweep_mid_run):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        s2 = Session()
        job = s2.get(ExerciseGenerationJob, job_id)
        # The sweep's verdict stands, and no exercise was left behind.
        assert job.status == "failed"
        assert job.exercise_id is None
        assert s2.query(Exercise).filter_by(class_id = class_id).count() == 0
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])


async def test_a_normal_run_still_stamps_its_heartbeat(test_engine):
    # The sweep is only as good as the heartbeat feeding it.
    Session = _sessionmaker()
    s = Session()
    class_id = _seed_class(s)
    doc_id = _seed_document(s)
    job_id = _seed_job(
        s, class_id, [doc_id], status = "queued", created_ago = 0, num_questions = 2,
    )
    s.commit()
    s.close()

    seen = []

    async def record_heartbeat(context, prompt, count, on_progress = None):
        on_progress(2)
        reader = Session()
        seen.append(reader.get(ExerciseGenerationJob, job_id).progress_at)
        reader.close()
        return _fake_questions(2)

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", record_heartbeat):
            await asyncio.to_thread(tasks.generate_exercise, str(job_id))

        # Committed and visible to another connection, which is what the sweep is.
        assert len(seen) == 1 and seen[0] is not None
        s2 = Session()
        assert s2.get(ExerciseGenerationJob, job_id).status == "succeeded"
        s2.close()
    finally:
        _cleanup(Session, [class_id], [doc_id])
