import logging
from datetime import datetime, timezone
from uuid import UUID

from celery import Celery
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from app.core import vectorstore
from app.core.config import settings
from app.core.storage import R2Storage
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
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

celery_app.conf.beat_schedule = {
    "generate-due-daily-quizzes": {
        "task": "worker.tasks.generate_due_daily_quizzes",
        "schedule": DAILY_QUIZ_CHECK_SECONDS,
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
            config_id = str(due.config.id)
            try:
                # No audience means nobody could ever open this quiz, so don't
                # spend an LLM call on it. Writing no row leaves the config due,
                # so it retries each tick until the local day rolls over.
                if count_matching_learners(session, due.config) == 0:
                    summary["skipped"].append(config_id)
                    continue

                generate_daily_quiz(session, due)
                summary["generated"].append(config_id)
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
            except Exception as e:
                session.rollback()
                logger.exception(
                    "Daily quiz generation failed for config %s on %s: %s",
                    config_id, due.quiz_date, e,
                )
                summary["failed"].append(config_id)
    finally:
        session.close()
    return summary
