from datetime import datetime, timezone
from uuid import UUID

from celery import Celery
from sqlalchemy import delete

from app.core import vectorstore
from app.core.config import settings
from app.core.storage import R2Storage
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from worker.db import SyncSessionLocal
from worker.processing import embed_texts, extract_text, split_into_chunks

celery_app = Celery("worker", broker = settings.REDIS_URL, backend = settings.REDIS_URL)


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

            # Flip to ready and promote the active version in one transaction so
            # the two writes are atomic together.
            version.processing_status = "ready"
            document = session.get(Document, document_id)
            document.active_version_number = version_number
            session.commit()
        except Exception as e:
            # The chunk inserts only happen in the final commit above, which never
            # ran here, so rollback discards them and the clean-slate delete already
            # cleared any older rows. Only the Chroma vectors need explicit cleanup.
            session.rollback()
            vectorstore.delete_version(document_id, version_number)
            version.processing_status = "failed"
            version.processing_error = str(e)
            session.commit()
    finally:
        session.close()
