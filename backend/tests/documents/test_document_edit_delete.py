import uuid
from datetime import date, datetime, time, timezone
from unittest.mock import MagicMock, patch

import pytest_asyncio
from sqlalchemy import func, select

from app.core.storage import StorageError
from app.modules.chat.models import ChatMessage, ChatMessageCitation, ChatSession
from app.modules.classes.models import Class
from app.modules.config.models import Category, Skill
from app.modules.documents.models import (
    Document,
    DocumentChunk,
    DocumentSkill,
    DocumentVersion,
)
from app.modules.exams.models import Exercise, ExerciseDocument
from app.modules.quiz.models import DailyQuizConfig
from tests.conftest import auth_header, seed_auth_user

BASE = "/api/v1/documents"


async def _seed_category(db, name = None):
    cat = Category(name = name or f"Cat {uuid.uuid4()}")
    db.add(cat)
    await db.flush()
    return cat


async def _seed_document(db, *, category = None, title = None, versions = 1):
    doc = Document(
        title = title or f"Doc {uuid.uuid4()}",
        description = "original description",
        category_id = category.id if category else None,
        active_version_number = 1,
    )
    db.add(doc)
    await db.flush()
    for n in range(1, versions + 1):
        db.add(DocumentVersion(
            document_id = doc.id,
            version_number = n,
            file_url = f"documents/{doc.id}/v{n}.pdf",
            file_name = "f.pdf",
            file_size_bytes = 10,
            mime_type = "application/pdf",
            processing_status = "ready",
        ))
    await db.flush()
    return doc


async def _seed_chunk(db, doc, version_number = 1, chunk_index = 0):
    chunk = DocumentChunk(
        document_id = doc.id,
        version_number = version_number,
        chunk_index = chunk_index,
        content = "chunk text",
        vector_id = f"{doc.id}:{version_number}:{chunk_index}",
    )
    db.add(chunk)
    await db.flush()
    return chunk


async def _seed_exercise_using(db, doc, version_number = 1):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    exercise = Exercise(
        title = "Exam",
        class_id = cls.id,
        start_time = datetime(2026, 1, 1, tzinfo = timezone.utc),
        end_time = datetime(2026, 1, 2, tzinfo = timezone.utc),
        duration_minutes = 60,
        pass_score = 0,
        total_points = 1,
    )
    db.add(exercise)
    await db.flush()
    db.add(ExerciseDocument(
        exercise_id = exercise.id,
        document_id = doc.id,
        version_number = version_number,
    ))
    await db.flush()
    return exercise


async def _seed_quiz_config_using(db, doc):
    config = DailyQuizConfig(
        name = f"Config {uuid.uuid4()}",
        prompt = "Make a quiz",
        source_document_id = doc.id,
        start_date = date(2026, 1, 1),
        push_time = time(9, 0),
    )
    db.add(config)
    await db.flush()
    return config


async def _seed_chat_session(db, doc = None):
    user = await seed_auth_user(db, role = "learner")
    session = ChatSession(
        user_id = user.id,
        document_id = doc.id if doc else None,
    )
    db.add(session)
    await db.flush()
    return session


async def _seed_citation(db, doc):
    chunk = await _seed_chunk(db, doc)
    session = await _seed_chat_session(db, doc)
    message = ChatMessage(session_id = session.id, role = "assistant", content = "answer")
    db.add(message)
    await db.flush()
    db.add(ChatMessageCitation(
        chat_message_id = message.id,
        document_chunk_id = chunk.id,
        relevance_score = 0.9,
    ))
    await db.flush()
    return chunk


@pytest_asyncio.fixture
def mock_cleanup():
    """Patch both external stores the delete touches, and hand back the mocks."""
    mock_vs = MagicMock()
    with patch("app.modules.documents.service.R2Storage") as mock_r2, \
         patch("app.modules.documents.service.vectorstore", mock_vs):
        yield mock_vs, mock_r2


# --------------------------------------------------------------------------
# PATCH /documents/{id}
# --------------------------------------------------------------------------

async def test_patch_updates_only_supplied_fields(client, db_session):
    cat = await _seed_category(db_session)
    doc = await _seed_document(db_session, category = cat)

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"title": "Renamed"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Renamed"
    # Untouched fields survive a partial update.
    assert body["description"] == "original description"
    assert body["category_id"] == str(cat.id)


async def test_patch_all_fields(client, db_session):
    cat = await _seed_category(db_session)
    other = await _seed_category(db_session)
    doc = await _seed_document(db_session, category = cat)

    resp = await client.patch(f"{BASE}/{doc.id}", json = {
        "title": "New title",
        "description": "new description",
        "category_id": str(other.id),
    })

    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "New title"
    assert body["description"] == "new description"
    assert body["category_id"] == str(other.id)


async def test_patch_unknown_document_404(client, db_session):
    resp = await client.patch(f"{BASE}/{uuid.uuid4()}", json = {"title": "X"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Document not found"


async def test_patch_unknown_category_422(client, db_session):
    doc = await _seed_document(db_session)
    resp = await client.patch(
        f"{BASE}/{doc.id}", json = {"category_id": str(uuid.uuid4())}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "Category not found"


async def test_patch_blank_title_rejected(client, db_session):
    doc = await _seed_document(db_session)
    resp = await client.patch(f"{BASE}/{doc.id}", json = {"title": ""})
    assert resp.status_code == 422


async def test_patch_title_category_collision_409(client, db_session):
    cat = await _seed_category(db_session)
    await _seed_document(db_session, category = cat, title = "Taken")
    doc = await _seed_document(db_session, category = cat, title = "Free")

    resp = await client.patch(f"{BASE}/{doc.id}", json = {"title": "Taken"})

    assert resp.status_code == 409
    assert "already uses this title" in resp.json()["detail"]


async def test_patch_same_title_is_not_a_collision(client, db_session):
    cat = await _seed_category(db_session)
    doc = await _seed_document(db_session, category = cat, title = "Keep")

    resp = await client.patch(
        f"{BASE}/{doc.id}", json = {"title": "Keep", "description": "edited"}
    )

    assert resp.status_code == 200
    assert resp.json()["description"] == "edited"


# --------------------------------------------------------------------------
# DELETE /documents/{id} — success and cleanup
# --------------------------------------------------------------------------

async def test_delete_removes_db_rows_and_cleans_both_stores(
    client, db_session, mock_cleanup
):
    mock_vs, mock_r2 = mock_cleanup
    cat = await _seed_category(db_session)
    doc = await _seed_document(db_session, category = cat, versions = 2)
    await _seed_chunk(db_session, doc)
    skill = Skill(
        category_id = cat.id, name = "S", basic_max = 50, intermediate_max = 80
    )
    db_session.add(skill)
    await db_session.flush()
    db_session.add(DocumentSkill(document_id = doc.id, skill_id = skill.id))
    await db_session.flush()

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 200
    assert resp.json() == {
        "deleted": 1,
        "versions_deleted": 2,
        "cleanup_warning": None,
    }

    # DB: the document and everything cascading off it.
    async def count(model, column):
        return await db_session.scalar(
            select(func.count()).select_from(model).where(column == doc.id)
        )

    assert await count(Document, Document.id) == 0
    assert await count(DocumentVersion, DocumentVersion.document_id) == 0
    assert await count(DocumentChunk, DocumentChunk.document_id) == 0
    assert await count(DocumentSkill, DocumentSkill.document_id) == 0

    # Chroma: cleaned for the whole document, once.
    mock_vs.delete_document.assert_called_once_with(doc.id)

    # R2: one delete per version file, not just the active one.
    deleted_keys = {c.args[0] for c in mock_r2.return_value.delete.call_args_list}
    assert deleted_keys == {
        f"documents/{doc.id}/v1.pdf",
        f"documents/{doc.id}/v2.pdf",
    }


async def test_delete_closes_document_scoped_chat_sessions(
    client, db_session, mock_cleanup
):
    doc = await _seed_document(db_session)
    scoped = await _seed_chat_session(db_session, doc)
    unscoped = await _seed_chat_session(db_session, None)

    resp = await client.delete(f"{BASE}/{doc.id}")
    assert resp.status_code == 200

    # Without this the SET NULL would silently widen the session to the whole
    # corpus instead of ending it.
    await db_session.refresh(scoped)
    await db_session.refresh(unscoped)
    assert scoped.is_active is False
    assert scoped.document_id is None
    # An unrelated session is untouched.
    assert unscoped.is_active is True


async def test_delete_unknown_document_404(client, db_session, mock_cleanup):
    resp = await client.delete(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Document not found"


# --------------------------------------------------------------------------
# DELETE /documents/{id} — the two guards
# --------------------------------------------------------------------------

async def test_delete_blocked_by_exam(client, db_session, mock_cleanup):
    mock_vs, mock_r2 = mock_cleanup
    doc = await _seed_document(db_session)
    await _seed_exercise_using(db_session, doc)

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 409
    assert resp.json()["detail"] == (
        "Cannot delete a document used by an exam. Delete the exam first."
    )
    # Nothing was touched anywhere.
    assert await db_session.get(Document, doc.id) is not None
    mock_vs.delete_document.assert_not_called()
    mock_r2.return_value.delete.assert_not_called()


async def test_delete_blocked_by_daily_quiz_config(client, db_session, mock_cleanup):
    doc = await _seed_document(db_session)
    await _seed_quiz_config_using(db_session, doc)

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 409
    assert "daily quiz config" in resp.json()["detail"]
    assert await db_session.get(Document, doc.id) is not None


async def test_delete_cascades_chat_citations(client, db_session, mock_cleanup):
    doc = await _seed_document(db_session)
    chunk = await _seed_citation(db_session, doc)

    # _seed_citation only hands back the chunk, so look up the message it
    # belongs to the same way a real citation would be found: by its chunk.
    message_id = (
        await db_session.scalar(
            select(ChatMessageCitation.chat_message_id).where(
                ChatMessageCitation.document_chunk_id == chunk.id
            )
        )
    )

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 200
    assert await db_session.get(Document, doc.id) is None
    # The citation row is gone (cascaded from document_chunks), but the chat
    # message it belonged to is untouched — the old answer keeps its text.
    assert (
        await db_session.scalar(
            select(func.count()).select_from(ChatMessageCitation).where(
                ChatMessageCitation.document_chunk_id == chunk.id
            )
        )
    ) == 0
    assert await db_session.get(ChatMessage, message_id) is not None


# --------------------------------------------------------------------------
# DELETE /documents/{id} — external cleanup failures are reported, not silent
# --------------------------------------------------------------------------

async def test_delete_reports_vector_cleanup_failure(client, db_session, mock_cleanup):
    mock_vs, mock_r2 = mock_cleanup
    mock_vs.delete_document.side_effect = RuntimeError("chroma down")
    doc = await _seed_document(db_session)

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 200
    assert resp.json()["cleanup_warning"] == "vector cleanup failed"
    # The DB row is still gone, and R2 cleanup still ran.
    assert await db_session.get(Document, doc.id) is None
    mock_r2.return_value.delete.assert_called_once()


async def test_delete_reports_file_cleanup_failure(client, db_session, mock_cleanup):
    mock_vs, mock_r2 = mock_cleanup
    mock_r2.return_value.delete.side_effect = StorageError("r2 down")
    doc = await _seed_document(db_session)

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 200
    assert resp.json()["cleanup_warning"] == "file cleanup failed"
    assert await db_session.get(Document, doc.id) is None


async def test_delete_reports_both_cleanup_failures(client, db_session, mock_cleanup):
    mock_vs, mock_r2 = mock_cleanup
    mock_vs.delete_document.side_effect = RuntimeError("chroma down")
    mock_r2.side_effect = StorageError("no R2 config")
    doc = await _seed_document(db_session)

    resp = await client.delete(f"{BASE}/{doc.id}")

    assert resp.status_code == 200
    assert resp.json()["cleanup_warning"] == "vector cleanup failed; file cleanup failed"
    assert await db_session.get(Document, doc.id) is None


# --------------------------------------------------------------------------
# Auth — both routes are admin-only
# --------------------------------------------------------------------------

async def test_patch_requires_token(auth_client, db_session):
    doc = await _seed_document(db_session)
    resp = await auth_client.patch(f"{BASE}/{doc.id}", json = {"title": "X"})
    assert resp.status_code == 401


async def test_patch_forbidden_for_learner(auth_client, db_session):
    doc = await _seed_document(db_session)
    learner = await seed_auth_user(db_session, role = "learner")
    resp = await auth_client.patch(
        f"{BASE}/{doc.id}", json = {"title": "X"}, headers = auth_header(learner)
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "Admin access required"}


async def test_delete_requires_token(auth_client, db_session):
    doc = await _seed_document(db_session)
    resp = await auth_client.delete(f"{BASE}/{doc.id}")
    assert resp.status_code == 401
    assert await db_session.get(Document, doc.id) is not None


async def test_delete_forbidden_for_learner(auth_client, db_session):
    doc = await _seed_document(db_session)
    learner = await seed_auth_user(db_session, role = "learner")
    resp = await auth_client.delete(f"{BASE}/{doc.id}", headers = auth_header(learner))
    assert resp.status_code == 403
    assert await db_session.get(Document, doc.id) is not None
