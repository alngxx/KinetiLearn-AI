import uuid
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine, delete
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

import worker.tasks as tasks
from app.core.config import settings
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion

# The worker runs on its own sync (psycopg2) session, so these tests can't use the
# async savepoint fixture. They point SyncSessionLocal at the same test DB the async
# suite uses, seed rows, call process_document directly (a Celery task is callable and
# runs eagerly), then clean up the committed rows.
sync_url = (
    make_url(settings.DATABASE_URL)
    .set(database = "KinetiLearn_test")
    .set(drivername = "postgresql+psycopg2")
)


def _sessionmaker():
    engine = create_engine(sync_url)
    return sessionmaker(bind = engine, expire_on_commit = False)


def _new_version(document_id, version_number, status):
    return DocumentVersion(
        document_id = document_id,
        version_number = version_number,
        file_url = "documents/x/v.pdf",
        file_name = "f.pdf",
        file_size_bytes = 1,
        mime_type = "application/pdf",
        processing_status = status,
    )


@contextmanager
def _mocked_pipeline(Session):
    # Replace every external dependency the worker touches, plus its session factory.
    mock_vs = MagicMock()
    mock_vs.add_chunks.return_value = ["vid0"]
    chunks = [{"index": 0, "content": "hello world", "token_count": 2}]
    with patch.object(tasks, "SyncSessionLocal", Session), \
         patch.object(tasks, "R2Storage") as mock_r2, \
         patch.object(tasks, "extract_text", return_value = "hello world"), \
         patch.object(tasks, "split_into_chunks", return_value = chunks), \
         patch.object(tasks, "embed_texts", return_value = [[0.1]]), \
         patch.object(tasks, "vectorstore", mock_vs):
        mock_r2.return_value.download.return_value = b"data"
        yield


def _cleanup(Session, document_id):
    s = Session()
    s.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
    s.execute(delete(DocumentVersion).where(DocumentVersion.document_id == document_id))
    s.execute(delete(Document).where(Document.id == document_id))
    s.commit()
    s.close()


async def test_first_version_auto_activates(test_engine):
    Session = _sessionmaker()
    doc_id = uuid.uuid4()
    s = Session()
    s.add(Document(id = doc_id, title = f"W {doc_id}", active_version_number = None))
    s.add(_new_version(doc_id, 1, "pending"))
    s.commit()
    s.close()

    try:
        with _mocked_pipeline(Session):
            tasks.process_document(str(doc_id), 1)

        s = Session()
        doc = s.get(Document, doc_id)
        ver = s.get(DocumentVersion, (doc_id, 1))
        assert ver.processing_status == "ready"
        assert doc.active_version_number == 1
        s.close()
    finally:
        _cleanup(Session, doc_id)


async def test_later_version_not_auto_activated(test_engine):
    Session = _sessionmaker()
    doc_id = uuid.uuid4()
    s = Session()
    s.add(Document(id = doc_id, title = f"W {doc_id}", active_version_number = 1))
    s.add(_new_version(doc_id, 1, "ready"))
    s.add(_new_version(doc_id, 2, "pending"))
    s.commit()
    s.close()

    try:
        with _mocked_pipeline(Session):
            tasks.process_document(str(doc_id), 2)

        s = Session()
        doc = s.get(Document, doc_id)
        ver2 = s.get(DocumentVersion, (doc_id, 2))
        assert ver2.processing_status == "ready"
        # Already-serving document keeps its active version; v2 waits for manual promote.
        assert doc.active_version_number == 1
        s.close()
    finally:
        _cleanup(Session, doc_id)


async def test_failure_path_skips_when_already_ready(test_engine):
    # Simulate a lost race: while this worker runs, another run commits the same
    # version as "ready"; then this worker fails. Its failure cleanup must not clobber
    # the winner's committed status/vectors.
    Session = _sessionmaker()
    doc_id = uuid.uuid4()
    s = Session()
    s.add(Document(id = doc_id, title = f"W {doc_id}", active_version_number = None))
    s.add(_new_version(doc_id, 1, "pending"))
    s.commit()
    s.close()

    def winner_then_fail(*args, **kwargs):
        # The winning worker finishes and commits "ready" via its own session...
        w = Session()
        ver = w.get(DocumentVersion, (doc_id, 1))
        ver.processing_status = "ready"
        w.commit()
        w.close()
        # ...then this worker blows up, entering the failure path.
        raise RuntimeError("boom")

    mock_vs = MagicMock()
    mock_vs.add_chunks.return_value = ["vid0"]
    chunks = [{"index": 0, "content": "x", "token_count": 1}]

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(tasks, "R2Storage") as mock_r2, \
             patch.object(tasks, "extract_text", return_value = "x"), \
             patch.object(tasks, "split_into_chunks", return_value = chunks), \
             patch.object(tasks, "embed_texts", side_effect = winner_then_fail), \
             patch.object(tasks, "vectorstore", mock_vs):
            mock_r2.return_value.download.return_value = b"data"
            tasks.process_document(str(doc_id), 1)

        s = Session()
        ver = s.get(DocumentVersion, (doc_id, 1))
        # Winner's status survives; the loser did not overwrite it to "failed".
        assert ver.processing_status == "ready"
        s.close()
        # delete_version fired once for the start-of-run clean slate, and NOT again
        # in the failure path — proving the guard skipped the destructive cleanup.
        assert mock_vs.delete_version.call_count == 1
    finally:
        _cleanup(Session, doc_id)
