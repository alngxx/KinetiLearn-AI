import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from celery import Celery
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.core import vectorstore
from app.core.config import settings
from app.core.storage import R2Storage
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import ExerciseGenerationJob
from app.modules.exams.service import run_generation_job
from app.modules.quiz.models import DailyQuizConfig
from app.modules.quiz.service import (
    count_matching_learners,
    find_due_configs,
    generate_daily_quiz,
)
from worker.db import SyncSessionLocal
from worker.processing import embed_texts, extract_text, split_into_chunks

logger = logging.getLogger(__name__)

celery_app = Celery("worker", broker = settings.REDIS_URL, backend = settings.REDIS_URL)

# Configs each have their own push_time and timezone, so Beat can't schedule them
# individually. It ticks on a fixed interval instead and the task works out which
# configs are due. 5 minutes keeps the worst-case delay invisible for a daily quiz
# without waking the worker 1440 times a day.
DAILY_QUIZ_CHECK_SECONDS = 300

# Stale generation jobs. Celery acks a task on delivery (task_acks_late is False),
# so a worker that dies between the ack and the commit takes the message with it
# and nothing will ever pick the job up again. Without this sweep such a job sits
# in "queued" or "running" forever and the admin's progress panel polls a bar that
# will never move. The fix has to live in the database, not the browser: a
# client-side timeout would only change what one open tab renders, leaving the row
# itself lying about the state of the world for every other reader — the class
# page, a second admin, a later poll of GET /exams/jobs/{id}.
STALE_JOB_CHECK_SECONDS = 300

# Measured from created_at. A live worker acks within milliseconds, so anything
# still unclaimed after this has no worker behind it (or a queue so backed up that
# failing fast and letting the admin retry beats an unbounded wait).
QUEUED_TIMEOUT_MINUTES = 15

# Measured from progress_at, which is re-stamped every batch — so this is "no
# batch has completed in half an hour", not "the job is taking a while". Sized
# against the worst realistic single batch: up to ~25k prompt tokens
# (MAX_CONTEXT_CHUNKS x CHUNK_TARGET_TOKENS) plus a growing avoid-list, and the
# OpenAI SDK's own 600s read timeout with 2 retries behind it.
RUNNING_STALL_MINUTES = 30

celery_app.conf.beat_schedule = {
    "generate-due-daily-quizzes": {
        "task": "worker.tasks.generate_due_daily_quizzes",
        "schedule": DAILY_QUIZ_CHECK_SECONDS,
    },
    "sweep-stale-generation-jobs": {
        "task": "worker.tasks.sweep_stale_generation_jobs",
        "schedule": STALE_JOB_CHECK_SECONDS,
    },
}


@celery_app.task
def process_document(document_id: UUID, version_number: int):
    # Celery serializes the UUID to a string over JSON, so coerce it back.
    if isinstance(document_id, str):
        document_id = UUID(document_id)

    session = SyncSessionLocal()
    try:
        version = session.get(DocumentVersion, (document_id, version_number))
        if version is None:
            return

        # Clean slate in case a previous run left partial rows/vectors behind.
        session.execute(
            delete(DocumentChunk).where(
                DocumentChunk.document_id == document_id,
                DocumentChunk.version_number == version_number,
            )
        )
        session.commit()
        vectorstore.delete_version(document_id, version_number)

        version.processing_status = "processing"
        session.commit()

        try:
            data = R2Storage().download(version.file_url)
            text = extract_text(version.mime_type, data)
            chunks = split_into_chunks(text)
            if not chunks:
                raise ValueError("No text could be extracted from the document")

            embeddings = embed_texts([c["content"] for c in chunks])
            vector_ids = vectorstore.add_chunks(
                document_id, version_number, chunks, embeddings
            )

            embedded_at = datetime.now(timezone.utc)
            for chunk, vid in zip(chunks, vector_ids):
                session.add(DocumentChunk(
                    document_id = document_id,
                    version_number = version_number,
                    chunk_index = chunk["index"],
                    content = chunk["content"],
                    token_count = chunk["token_count"],
                    vector_id = vid,
                    embedded_at = embedded_at,
                ))

            # Flip to ready and, only for the very first version ever readied for
            # this document, promote it to active. Later versions wait for an admin
            # to promote them manually. Both writes share one commit so they stay
            # atomic together.
            version.processing_status = "ready"
            document = session.get(Document, document_id)
            if document.active_version_number is None:
                document.active_version_number = version_number
            session.commit()
        except Exception as e:
            # The chunk inserts only happen in the final commit above, which never
            # ran here, so rollback discards them and the clean-slate delete already
            # cleared any older rows. Only the Chroma vectors need explicit cleanup.
            session.rollback()
            # Lost-race guard: if another run already committed this exact version as
            # "ready", its vectors and status are the winner — do not clobber them.
            # rollback() here is a no-op (no txn was open) and won't refresh cached
            # state, so expire first to force a real read of the committed status.
            session.expire_all()
            current = session.get(DocumentVersion, (document_id, version_number))
            if current is not None and current.processing_status == "ready":
                logger.warning(
                    "Skipping failure cleanup for document %s version %s: already "
                    "marked ready by another run (processing race).",
                    document_id, version_number,
                )
            elif current is not None:
                vectorstore.delete_version(document_id, version_number)
                current.processing_status = "failed"
                current.processing_error = str(e)
                session.commit()
    finally:
        session.close()


def _stamp_run(session, config_id: UUID, status: str, error: str | None = None):
    """Record this attempt's outcome on the config.

    Issued as a Core UPDATE by id rather than through the ORM object: the failure
    branches call this after a rollback, which expires every instance in the
    session. Committed on its own so the stamp survives whatever went wrong with
    the quiz itself — it is the only place an admin can see that a run failed.
    """
    session.execute(
        update(DailyQuizConfig)
        .where(DailyQuizConfig.id == config_id)
        .values(
            last_run_at = datetime.now(timezone.utc),
            last_run_status = status,
            last_run_error = error,
        )
    )
    session.commit()


@celery_app.task
def generate_due_daily_quizzes():
    """Beat entry point: generate today's quiz for every config that is due.

    One quiz per config per day, shared by the whole audience — daily_quizzes has
    no user_id. Each config is isolated: nobody watches this run, so one config's
    LLM failure must not cost the others their quiz. The returned summary lands in
    the Celery result backend, which is the only place a failure is visible.
    """
    session = SyncSessionLocal()
    summary = {"generated": [], "skipped": [], "failed": []}
    try:
        for due in find_due_configs(session, datetime.now(timezone.utc)):
            # Captured before the try: a rollback below expires the ORM instance,
            # and the stamp needs this id afterwards.
            config_uuid = due.config.id
            config_id = str(config_uuid)
            try:
                # No audience means nobody could ever open this quiz, so don't
                # spend an LLM call on it. Writing no row leaves the config due,
                # so it retries each tick until the local day rolls over.
                if count_matching_learners(session, due.config) == 0:
                    summary["skipped"].append(config_id)
                    _stamp_run(session, config_uuid, "skipped", "No matching learners")
                    continue

                generate_daily_quiz(session, due)
                summary["generated"].append(config_id)
                _stamp_run(session, config_uuid, "success")
            except IntegrityError:
                # Two overlapping ticks both passed the existence check and raced
                # to insert. The unique constraint on (config_id, quiz_date) picked
                # a winner; this run is the loser and its quiz already exists.
                session.rollback()
                logger.warning(
                    "Daily quiz for config %s on %s already generated by another "
                    "run (insert race).",
                    config_id, due.quiz_date,
                )
                summary["skipped"].append(config_id)
                _stamp_run(
                    session, config_uuid, "skipped", "Already generated by another run"
                )
            except Exception as e:
                session.rollback()
                logger.exception(
                    "Daily quiz generation failed for config %s on %s: %s",
                    config_id, due.quiz_date, e,
                )
                summary["failed"].append(config_id)
                _stamp_run(session, config_uuid, "failed", str(e))
    finally:
        session.close()
    return summary


@celery_app.task
def generate_exercise(job_id: UUID):
    """Generate the exercise for one queued job. Enqueued by ExamService.

    The job row carries everything the run needs, so nothing is passed here but its
    id — and the run is guarded against redelivery inside run_generation_job.
    """
    # Celery serializes the UUID to a string over JSON, so coerce it back.
    if isinstance(job_id, str):
        job_id = UUID(job_id)

    session = SyncSessionLocal()
    try:
        run_generation_job(session, job_id)
    finally:
        session.close()


@celery_app.task
def sweep_stale_generation_jobs():
    """Fail exam generation jobs that no worker is going to finish.

    Two different faults, told apart so the admin knows which one they have:
    a job nobody ever claimed means no worker is running, while a job that
    started and then went quiet means a worker took it and died mid-batch.
    Returns a summary for the Celery result backend, same as the daily quiz task.
    """
    now = datetime.now(timezone.utc)
    queued_cutoff = now - timedelta(minutes = QUEUED_TIMEOUT_MINUTES)
    running_cutoff = now - timedelta(minutes = RUNNING_STALL_MINUTES)

    session = SyncSessionLocal()
    summary = {"queued": [], "stalled": []}
    try:
        stale = session.execute(
            select(ExerciseGenerationJob).where(
                or_(
                    (ExerciseGenerationJob.status == "queued")
                    & (ExerciseGenerationJob.created_at < queued_cutoff),
                    # COALESCE so a running job written before progress_at existed,
                    # or one killed before its first batch, is still reachable.
                    (ExerciseGenerationJob.status == "running")
                    & (
                        func.coalesce(
                            ExerciseGenerationJob.progress_at,
                            ExerciseGenerationJob.created_at,
                        )
                        < running_cutoff
                    ),
                )
            )
        ).scalars().all()

        for job in stale:
            # Captured before the overwrite below, or the log line reports the
            # status this sweep just wrote rather than the fault it found.
            was = job.status
            if was == "queued":
                message = (
                    f"No worker picked this up within {QUEUED_TIMEOUT_MINUTES} "
                    "minutes, so it was stopped. Check the generation worker is "
                    "running, then try again."
                )
                summary["queued"].append(str(job.id))
            else:
                message = (
                    f"Generation stopped responding after {job.questions_done} of "
                    f"{job.num_questions} questions and was cancelled. Nothing was "
                    "saved — try again."
                )
                summary["stalled"].append(str(job.id))

            job.status = "failed"
            job.error = message
            job.finished_at = now
            logger.warning(
                "Failing stale generation job %s (was %s, %s/%s done).",
                job.id, was, job.questions_done, job.num_questions,
            )

        # succeeded and failed jobs are never in `stale`, so a finished run is
        # never rewritten by this sweep.
        session.commit()
    finally:
        session.close()
    return summary
