"""GET /classes/{class_id}/documents — the learner-facing Materials list.

Reference only: title, category and format, filtered to the same predicate
ChatService._class_scope uses for retrieval, so this list never promises more
than the AI Mentor can actually answer from.
"""
import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.classes.models import Class, ClassMember
from app.modules.config.models import Category
from app.modules.documents.models import ClassDocument, Document, DocumentVersion

BASE = "/api/v1/classes"


@pytest_asyncio.fixture
async def auth_client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app = app)
    async with AsyncClient(transport = transport, base_url = "http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def _auth(user):
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {"Authorization": f"Bearer {token}"}


async def _seed_user(db):
    user = User(
        id = uuid.uuid4(),
        email = f"{uuid.uuid4()}@kineti.com",
        password_hash = get_password_hash("secret123"),
        full_name = "Seed Learner",
        role = "learner",
    )
    db.add(user)
    await db.flush()
    return user


async def _seed_class(db, *members):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    for user in members:
        db.add(ClassMember(class_id = cls.id, user_id = user.id))
    await db.flush()
    return cls


async def _seed_document(
    db,
    cls,
    *,
    title = None,
    category = None,
    mime_type = "application/pdf",
    processing_status = "ready",
    is_active = True,
    active_version_number = 1,
):
    doc = Document(
        title = title or f"Doc {uuid.uuid4()}",
        category_id = category.id if category is not None else None,
        active_version_number = active_version_number,
        is_active = is_active,
    )
    db.add(doc)
    await db.flush()
    db.add(DocumentVersion(
        document_id = doc.id,
        version_number = 1,
        file_url = "documents/x/v1.pdf",
        file_name = "f.pdf",
        file_size_bytes = 10,
        mime_type = mime_type,
        processing_status = processing_status,
    ))
    db.add(ClassDocument(class_id = cls.id, document_id = doc.id))
    await db.flush()
    return doc


async def test_member_sees_titles_category_and_format(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    category = Category(name = "Compliance")
    db_session.add(category)
    await db_session.flush()
    doc = await _seed_document(db_session, cls, title = "Leave handbook", category = category)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{cls.id}/documents", headers = _auth(user))
    assert resp.status_code == 200
    body = resp.json()
    assert body == [{
        "id": str(doc.id),
        "title": "Leave handbook",
        "category_name": "Compliance",
        "format": "PDF",
    }]


async def test_uncategorized_document_has_null_category_name(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await _seed_document(db_session, cls, title = "Loose doc")
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{cls.id}/documents", headers = _auth(user))
    assert resp.json()[0]["category_name"] is None


async def test_response_has_no_download_url(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await _seed_document(db_session, cls)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{cls.id}/documents", headers = _auth(user))
    assert set(resp.json()[0].keys()) == {"id", "title", "category_name", "format"}


async def test_non_member_rejected(auth_client, db_session):
    member = await _seed_user(db_session)
    outsider = await _seed_user(db_session)
    cls = await _seed_class(db_session, member)
    await _seed_document(db_session, cls)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{cls.id}/documents", headers = _auth(outsider))
    assert resp.status_code == 403
    assert resp.json() == {"detail": "You are not a member of this class."}


async def test_excludes_not_ready_version(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await _seed_document(db_session, cls, title = "Still processing", processing_status = "processing")
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{cls.id}/documents", headers = _auth(user))
    assert resp.json() == []


async def test_excludes_soft_deleted_document(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await _seed_document(db_session, cls, title = "Removed", is_active = False)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{cls.id}/documents", headers = _auth(user))
    assert resp.json() == []


async def test_excludes_document_with_no_active_version(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await _seed_document(db_session, cls, title = "No active version", active_version_number = None)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{cls.id}/documents", headers = _auth(user))
    assert resp.json() == []


async def test_excludes_documents_from_other_classes(auth_client, db_session):
    user = await _seed_user(db_session)
    mine = await _seed_class(db_session, user)
    other = await _seed_class(db_session, user)
    await _seed_document(db_session, mine, title = "Mine")
    await _seed_document(db_session, other, title = "Not mine")
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{mine.id}/documents", headers = _auth(user))
    assert [row["title"] for row in resp.json()] == ["Mine"]


async def test_requires_auth(auth_client, db_session):
    cls = await _seed_class(db_session)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/{cls.id}/documents")
    assert resp.status_code == 401
