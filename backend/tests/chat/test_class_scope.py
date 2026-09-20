"""Class-scoped chat sessions: retrieval restricted to a class's documents.

Mirrors the document-scope tests in test_chat.py — same mocking of
vectorstore.search/embed_query/stream_chat, same assertion on
search.call_args.args[1] — but for the class branch of _session_scope.
"""
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.chat.models import ChatSession
from app.modules.classes.models import Class, ClassMember
from app.modules.documents.models import ClassDocument, Document, DocumentVersion

BASE = "/api/v1/chat"


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


async def _seed_document(db, cls = None, *, status = "ready", is_active = True):
    doc = Document(title = f"Doc {uuid.uuid4()}", active_version_number = 1, is_active = is_active)
    db.add(doc)
    await db.flush()
    db.add(DocumentVersion(
        document_id = doc.id,
        version_number = 1,
        file_url = "documents/x/v1.pdf",
        file_name = "f.pdf",
        file_size_bytes = 10,
        mime_type = "application/pdf",
        processing_status = status,
    ))
    if cls is not None:
        db.add(ClassDocument(class_id = cls.id, document_id = doc.id))
    await db.flush()
    return doc


async def _seed_session(db, user, *, class_id = None):
    session = ChatSession(user_id = user.id, class_id = class_id)
    db.add(session)
    await db.flush()
    return session


def _fake_stream(deltas, usage_tokens = 42):
    async def fake(messages, usage):
        for delta in deltas:
            yield delta
        usage["total_tokens"] = usage_tokens
    return fake


def _mock_search(hits):
    return patch("app.core.vectorstore.search", MagicMock(return_value = hits))


def _mock_embed():
    return patch(
        "app.modules.chat.service.embed_query",
        new = AsyncMock(return_value = [0.1] * 1536),
    )


def _parse_sse(raw: str) -> list[tuple[str, dict]]:
    events = []
    for block in raw.strip().split("\n\n"):
        if not block.strip():
            continue
        name, data = block.split("\n", 1)
        events.append((name.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
    return events


def _tokens(events):
    return "".join(d["content"] for name, d in events if name == "token")


async def _ask(client, user, session, question = "What is covered here?"):
    async with client.stream(
        "POST",
        f"{BASE}/messages",
        json = {"session_id": str(session.id), "content": question},
        headers = _auth(user),
    ) as resp:
        body = "".join([c async for c in resp.aiter_text()])
        status_code = resp.status_code
    return status_code, body


async def test_class_session_searches_only_its_classs_documents(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    scoped = await _seed_document(db_session, cls)
    session = await _seed_session(db_session, user, class_id = cls.id)
    await db_session.commit()

    search = MagicMock(return_value = [{"vector_id": f"{scoped.id}:1:0", "similarity": 0.8}])
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["answer"])
    ):
        await _ask(auth_client, user, session)

    assert search.call_args.args[1] == [(scoped.id, 1)]


async def test_other_classs_document_is_excluded_from_scope(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    other_cls = await _seed_class(db_session, user)
    scoped = await _seed_document(db_session, cls)
    await _seed_document(db_session, other_cls)
    session = await _seed_session(db_session, user, class_id = cls.id)
    await db_session.commit()

    search = MagicMock(return_value = [{"vector_id": f"{scoped.id}:1:0", "similarity": 0.8}])
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["answer"])
    ):
        await _ask(auth_client, user, session)

    assert search.call_args.args[1] == [(scoped.id, 1)]


async def test_class_scope_excludes_not_ready_document(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    good = await _seed_document(db_session, cls)
    await _seed_document(db_session, cls, status = "processing")
    session = await _seed_session(db_session, user, class_id = cls.id)
    await db_session.commit()

    search = MagicMock(return_value = [{"vector_id": f"{good.id}:1:0", "similarity": 0.8}])
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["answer"])
    ):
        await _ask(auth_client, user, session)

    assert search.call_args.args[1] == [(good.id, 1)]


async def test_create_session_for_class_not_a_member_of_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session)  # user is not a member
    await db_session.commit()

    resp = await auth_client.post(
        f"{BASE}/sessions", json = {"class_id": str(cls.id)}, headers = _auth(user),
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "You are not a member of this class."}


async def test_create_session_with_class_and_document_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls)
    await db_session.commit()

    resp = await auth_client.post(
        f"{BASE}/sessions",
        json = {"class_id": str(cls.id), "document_id": str(doc.id)},
        headers = _auth(user),
    )
    assert resp.status_code == 400


async def test_create_session_for_class_member_succeeds(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await db_session.commit()

    resp = await auth_client.post(
        f"{BASE}/sessions", json = {"class_id": str(cls.id)}, headers = _auth(user),
    )
    assert resp.status_code == 201
    assert resp.json()["class_id"] == str(cls.id)


# The session outlives enrolment. Losing membership must collapse retrieval to
# nothing, not keep answering from a class the learner has since left.
async def test_losing_membership_collapses_scope_to_no_match(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    doc = await _seed_document(db_session, cls)
    session = await _seed_session(db_session, user, class_id = cls.id)
    await db_session.commit()

    await db_session.execute(
        delete(ClassMember).where(
            ClassMember.class_id == cls.id, ClassMember.user_id == user.id
        )
    )
    await db_session.commit()

    fake = _fake_stream(["should not run"])
    with _mock_embed(), _mock_search([{"vector_id": f"{doc.id}:1:0", "similarity": 0.9}]), patch(
        "app.modules.chat.service.stream_chat", fake
    ):
        _, body = await _ask(auth_client, user, session)

    events = _parse_sse(body)
    assert "couldn't find anything" in _tokens(events)
    done = next(d for name, d in events if name == "done")
    assert done["citations"] == []
