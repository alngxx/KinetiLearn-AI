import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.config.models import Category, Skill
from app.modules.documents.models import Document, DocumentVersion

BASE = "/api/v1/documents"


@pytest_asyncio.fixture
async def auth_client(db_session):
    # These routes run real auth, so only get_db is overridden here.
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


async def _seed_user(db, role = "learner"):
    user = User(
        id = uuid.uuid4(),
        email = f"{uuid.uuid4()}@kineti.com",
        password_hash = get_password_hash("secret123"),
        full_name = "Seed User",
        role = role,
    )
    db.add(user)
    await db.flush()
    return user


async def _seed_category(db):
    cat = Category(name = f"Cat {uuid.uuid4()}")
    db.add(cat)
    await db.flush()
    return cat


async def _seed_document(
    db,
    *,
    category = None,
    is_active = True,
    active_version = None,
    created_at = None,
):
    doc = Document(
        title = f"Doc {uuid.uuid4()}",
        category_id = category.id if category else None,
        is_active = is_active,
        active_version_number = active_version,
        **({"created_at": created_at} if created_at else {}),
    )
    db.add(doc)
    await db.flush()
    return doc


async def _seed_version(
    db,
    document,
    version_number,
    *,
    status = "ready",
    change_note = None,
):
    version = DocumentVersion(
        document_id = document.id,
        version_number = version_number,
        file_url = f"documents/{document.id}/v{version_number}.pdf",
        file_name = f"f{version_number}.pdf",
        file_size_bytes = 100 * version_number,
        mime_type = "application/pdf",
        processing_status = status,
        change_note = change_note,
    )
    db.add(version)
    await db.flush()
    return version


async def _seed_skill(db, category = None):
    cat = category or await _seed_category(db)
    skill = Skill(
        category_id = cat.id, name = f"Skill {uuid.uuid4()}", basic_max = 50, intermediate_max = 80
    )
    db.add(skill)
    await db.flush()
    return skill


# --------------------------------------------------------------------------
# GET /documents
# --------------------------------------------------------------------------

async def test_list_default_active_only_newest_first(client, db_session):
    base = datetime.now(timezone.utc) - timedelta(hours = 1)
    older = await _seed_document(db_session, created_at = base)
    await _seed_version(db_session, older, 1)
    newer = await _seed_document(db_session, created_at = base + timedelta(minutes = 5))
    await _seed_version(db_session, newer, 1)
    inactive = await _seed_document(db_session, is_active = False, created_at = base + timedelta(minutes = 10))
    await _seed_version(db_session, inactive, 1)

    resp = await client.get(BASE)
    assert resp.status_code == 200
    ids = [row["document_id"] for row in resp.json()]
    assert ids == [str(newer.id), str(older.id)]


async def test_list_category_filter(client, db_session):
    cat_a = await _seed_category(db_session)
    cat_b = await _seed_category(db_session)
    doc_a = await _seed_document(db_session, category = cat_a)
    await _seed_version(db_session, doc_a, 1)
    doc_b = await _seed_document(db_session, category = cat_b)
    await _seed_version(db_session, doc_b, 1)

    resp = await client.get(BASE, params = {"category_id": str(cat_a.id)})
    assert resp.status_code == 200
    ids = [row["document_id"] for row in resp.json()]
    assert ids == [str(doc_a.id)]


async def test_list_include_inactive(client, db_session):
    inactive = await _seed_document(db_session, is_active = False)
    await _seed_version(db_session, inactive, 1)

    resp = await client.get(BASE, params = {"include_inactive": "true"})
    assert resp.status_code == 200
    ids = [row["document_id"] for row in resp.json()]
    assert str(inactive.id) in ids


async def test_list_category_and_include_inactive_combined(client, db_session):
    cat = await _seed_category(db_session)
    other_cat = await _seed_category(db_session)
    matching = await _seed_document(db_session, category = cat, is_active = False)
    await _seed_version(db_session, matching, 1)
    wrong_category = await _seed_document(db_session, category = other_cat, is_active = False)
    await _seed_version(db_session, wrong_category, 1)

    resp = await client.get(
        BASE, params = {"category_id": str(cat.id), "include_inactive": "true"}
    )
    assert resp.status_code == 200
    ids = [row["document_id"] for row in resp.json()]
    assert ids == [str(matching.id)]


async def test_list_status_uses_active_version_when_set(client, db_session):
    doc = await _seed_document(db_session, active_version = 1)
    await _seed_version(db_session, doc, 1, status = "ready")
    await _seed_version(db_session, doc, 2, status = "processing")

    resp = await client.get(BASE)
    row = next(r for r in resp.json() if r["document_id"] == str(doc.id))
    assert row["active_version_processing_status"] == "ready"


async def test_list_status_uses_latest_version_when_none_active(client, db_session):
    doc = await _seed_document(db_session, active_version = None)
    await _seed_version(db_session, doc, 1, status = "ready")
    await _seed_version(db_session, doc, 2, status = "processing")

    resp = await client.get(BASE)
    row = next(r for r in resp.json() if r["document_id"] == str(doc.id))
    assert row["active_version_processing_status"] == "processing"


async def test_list_query_count_is_constant_regardless_of_list_size(
    client, db_session, test_engine
):
    # Guards against get_all() regressing into a per-document loop: 1 base
    # query + 2 batched follow-up queries, no matter how many documents match.
    for _ in range(5):
        doc = await _seed_document(db_session)
        await _seed_version(db_session, doc, 1)

    statements = []

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(test_engine.sync_engine, "before_cursor_execute", before_cursor_execute)
    try:
        resp = await client.get(BASE)
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", before_cursor_execute)

    assert resp.status_code == 200
    assert len(resp.json()) >= 5
    assert len(statements) == 3, statements


async def test_list_requires_authentication(auth_client):
    resp = await auth_client.get(BASE)
    assert resp.status_code == 401


async def test_list_requires_admin(auth_client, db_session):
    learner = await _seed_user(db_session, role = "learner")
    resp = await auth_client.get(BASE, headers = _auth(learner))
    assert resp.status_code == 403


# --------------------------------------------------------------------------
# GET /documents/{id}
# --------------------------------------------------------------------------

async def test_detail_lists_all_versions_newest_first(client, db_session):
    doc = await _seed_document(db_session)
    await _seed_version(db_session, doc, 1, status = "ready", change_note = "first")
    await _seed_version(db_session, doc, 2, status = "processing", change_note = "second")

    resp = await client.get(f"{BASE}/{doc.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert [v["version_number"] for v in body["versions"]] == [2, 1]
    assert body["versions"][0]["processing_status"] == "processing"
    assert body["versions"][1]["processing_status"] == "ready"
    assert body["versions"][1]["change_note"] == "first"


async def test_detail_includes_skill_ids(client, db_session):
    doc = await _seed_document(db_session)
    await _seed_version(db_session, doc, 1)
    skill = await _seed_skill(db_session)
    await client.post(f"{BASE}/{doc.id}/skills/{skill.id}")

    resp = await client.get(f"{BASE}/{doc.id}")
    assert resp.status_code == 200
    assert str(skill.id) in resp.json()["skill_ids"]


async def test_detail_empty_document_no_versions_no_skills(client, db_session):
    doc = Document(title = f"Doc {uuid.uuid4()}")
    db_session.add(doc)
    await db_session.flush()

    resp = await client.get(f"{BASE}/{doc.id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["versions"] == []
    assert body["skill_ids"] == []


async def test_detail_unknown_document_404(client):
    resp = await client.get(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_detail_requires_authentication(auth_client, db_session):
    doc = await _seed_document(db_session)
    await _seed_version(db_session, doc, 1)
    resp = await auth_client.get(f"{BASE}/{doc.id}")
    assert resp.status_code == 401


async def test_detail_requires_admin(auth_client, db_session):
    doc = await _seed_document(db_session)
    await _seed_version(db_session, doc, 1)
    learner = await _seed_user(db_session, role = "learner")
    resp = await auth_client.get(f"{BASE}/{doc.id}", headers = _auth(learner))
    assert resp.status_code == 403
