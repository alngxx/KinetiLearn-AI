import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.chat.models import ChatMessage, ChatMessageCitation, ChatSession
from app.modules.chat.service import SESSION_LIST_LIMIT
from app.modules.classes.models import Class
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import Exercise

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


# A session the sidebar should list: it has a turn, so it has a title.
async def _seed_chat(db, user, title = "What is the leave policy?", *, minutes_ago = 0,
                     exercise_id = None, with_messages = True):
    at = datetime.now(timezone.utc) - timedelta(minutes = minutes_ago)
    session = ChatSession(
        user_id = user.id,
        exercise_id = exercise_id,
        title = title if with_messages else None,
        updated_at = at,
    )
    db.add(session)
    await db.flush()
    if with_messages:
        db.add(ChatMessage(
            session_id = session.id, role = "user", content = title, created_at = at,
        ))
        db.add(ChatMessage(
            session_id = session.id,
            role = "assistant",
            content = f"Answer to: {title}",
            created_at = at + timedelta(milliseconds = 1),
        ))
        await db.flush()
    return session


async def _seed_exercise(db):
    klass = Class(name = f"Class {uuid.uuid4()}")
    db.add(klass)
    await db.flush()
    now = datetime.now(timezone.utc)
    exercise = Exercise(
        class_id = klass.id,
        title = "Q3 Compliance",
        start_time = now - timedelta(hours = 2),
        end_time = now - timedelta(hours = 1),
        duration_minutes = 60,
        pass_score = 1,
        total_points = 5,
    )
    db.add(exercise)
    await db.flush()
    return exercise


async def _seed_chunk(db):
    doc = Document(title = "Leave handbook", active_version_number = 1, is_active = True)
    db.add(doc)
    await db.flush()
    db.add(DocumentVersion(
        document_id = doc.id,
        version_number = 1,
        file_url = "documents/x/v1.pdf",
        file_name = "f.pdf",
        file_size_bytes = 10,
        mime_type = "application/pdf",
        processing_status = "ready",
    ))
    await db.flush()
    chunk = DocumentChunk(
        document_id = doc.id,
        version_number = 1,
        chunk_index = 2,
        content = "Employees accrue twenty days of annual leave.",
        vector_id = f"{doc.id}:1:2",
    )
    db.add(chunk)
    await db.flush()
    return doc, chunk


async def test_list_returns_own_sessions_most_recent_first(auth_client, db_session):
    user = await _seed_user(db_session)
    await _seed_chat(db_session, user, "oldest", minutes_ago = 30)
    await _seed_chat(db_session, user, "newest", minutes_ago = 1)
    await _seed_chat(db_session, user, "middle", minutes_ago = 10)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/sessions", headers = _auth(user))
    assert resp.status_code == 200
    assert [row["title"] for row in resp.json()] == ["newest", "middle", "oldest"]


async def test_list_excludes_another_learners_sessions(auth_client, db_session):
    user = await _seed_user(db_session)
    other = await _seed_user(db_session)
    await _seed_chat(db_session, user, "mine")
    await _seed_chat(db_session, other, "theirs")
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/sessions", headers = _auth(user))
    assert [row["title"] for row in resp.json()] == ["mine"]


# Explain sessions answer only from their own exam's documents, and the general
# panel gives no sign of that narrower scope. The result page is their entry point.
async def test_list_excludes_explain_sessions(auth_client, db_session):
    user = await _seed_user(db_session)
    exercise = await _seed_exercise(db_session)
    await _seed_chat(db_session, user, "a general question")
    await _seed_chat(
        db_session, user, "I just took the exam", exercise_id = exercise.id
    )
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/sessions", headers = _auth(user))
    body = resp.json()
    assert [row["title"] for row in body] == ["a general question"]
    assert body[0]["exercise_id"] is None


# create_session commits on its own, so a first message that never landed leaves
# an empty session behind. It is not a conversation and must not be listed.
async def test_list_excludes_sessions_with_no_messages(auth_client, db_session):
    user = await _seed_user(db_session)
    await _seed_chat(db_session, user, "real conversation")
    await _seed_chat(db_session, user, with_messages = False)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/sessions", headers = _auth(user))
    assert [row["title"] for row in resp.json()] == ["real conversation"]


async def test_list_is_capped(auth_client, db_session):
    user = await _seed_user(db_session)
    for i in range(SESSION_LIST_LIMIT + 5):
        await _seed_chat(db_session, user, f"chat {i}", minutes_ago = i)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/sessions", headers = _auth(user))
    body = resp.json()
    assert len(body) == SESSION_LIST_LIMIT
    # The cap keeps the newest, not an arbitrary slice.
    assert body[0]["title"] == "chat 0"


async def test_list_requires_auth(auth_client):
    resp = await auth_client.get(f"{BASE}/sessions")
    assert resp.status_code == 401


async def test_messages_come_back_in_order_with_citations(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_chat(db_session, user, "What is the leave policy?")
    doc, chunk = await _seed_chunk(db_session)

    assistant = (await db_session.execute(
        select(ChatMessage).where(
            ChatMessage.session_id == session.id,
            ChatMessage.role == "assistant",
        )
    )).scalar_one()
    db_session.add(ChatMessageCitation(
        chat_message_id = assistant.id,
        document_chunk_id = chunk.id,
        relevance_score = 0.87,
    ))
    await db_session.commit()

    resp = await auth_client.get(
        f"{BASE}/sessions/{session.id}/messages", headers = _auth(user)
    )
    assert resp.status_code == 200
    body = resp.json()

    # The question sorts before its answer — the millisecond _persist_turn adds.
    assert [m["role"] for m in body] == ["user", "assistant"]
    assert body[0]["content"] == "What is the leave policy?"
    assert body[0]["citations"] == []

    citation = body[1]["citations"][0]
    assert citation["document_chunk_id"] == str(chunk.id)
    assert citation["document_id"] == str(doc.id)
    assert citation["document_title"] == "Leave handbook"
    assert citation["chunk_index"] == 2
    assert citation["content"] == "Employees accrue twenty days of annual leave."
    # relevance_score is a REAL column, so it comes back at float4 precision
    # rather than the float that was stored.
    assert citation["relevance_score"] == pytest.approx(0.87, abs = 1e-6)


async def test_messages_empty_for_a_session_with_no_turns(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_chat(db_session, user, with_messages = False)
    await db_session.commit()

    resp = await auth_client.get(
        f"{BASE}/sessions/{session.id}/messages", headers = _auth(user)
    )
    assert resp.status_code == 200
    assert resp.json() == []


async def test_messages_on_another_learners_session_rejected(auth_client, db_session):
    owner = await _seed_user(db_session)
    intruder = await _seed_user(db_session)
    session = await _seed_chat(db_session, owner, "private")
    await db_session.commit()

    resp = await auth_client.get(
        f"{BASE}/sessions/{session.id}/messages", headers = _auth(intruder)
    )
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Chat session not found."}

    # Same status and body as an id that never existed — no way to probe.
    missing = await auth_client.get(
        f"{BASE}/sessions/{uuid.uuid4()}/messages", headers = _auth(intruder)
    )
    assert missing.status_code == 404
    assert missing.json() == resp.json()


async def test_messages_requires_auth(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_chat(db_session, user)
    await db_session.commit()

    resp = await auth_client.get(f"{BASE}/sessions/{session.id}/messages")
    assert resp.status_code == 401
