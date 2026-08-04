import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core.dependencies import get_db
from app.core.llm import LLMError
from app.main import app
from app.modules.auth.models import User
from app.modules.chat.models import ChatMessage, ChatMessageCitation, ChatSession
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.core.security import create_access_token, get_password_hash

BASE = "/api/v1/chat"


@pytest_asyncio.fixture
async def auth_client(db_session):
    # Learner endpoints run real auth, so only get_db is overridden here.
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


async def _seed_session(db, user):
    session = ChatSession(user_id = user.id)
    db.add(session)
    await db.flush()
    return session


async def _seed_document(
    db, *, num_chunks = 3, active_version = 1, versions = (1,),
    status = "ready", is_active = True,
):
    doc = Document(
        title = f"Doc {uuid.uuid4()}",
        active_version_number = active_version,
        is_active = is_active,
    )
    db.add(doc)
    await db.flush()
    for version_number in versions:
        db.add(DocumentVersion(
            document_id = doc.id,
            version_number = version_number,
            file_url = f"documents/x/v{version_number}.pdf",
            file_name = "f.pdf",
            file_size_bytes = 10,
            mime_type = "application/pdf",
            processing_status = status,
        ))
        await db.flush()
        for i in range(num_chunks):
            db.add(DocumentChunk(
                document_id = doc.id,
                version_number = version_number,
                chunk_index = i,
                content = f"v{version_number} chunk {i} content",
                vector_id = f"{doc.id}:{version_number}:{i}",
            ))
        await db.flush()
    return doc


def _parse_sse(raw: str) -> list[tuple[str, dict]]:
    events = []
    for block in raw.strip().split("\n\n"):
        if not block.strip():
            continue
        name, data = block.split("\n", 1)
        events.append((
            name.removeprefix("event: "),
            json.loads(data.removeprefix("data: ")),
        ))
    return events


def _tokens(events):
    return "".join(d["content"] for name, d in events if name == "token")


def _fake_stream(deltas, *, fail_after = None, usage_tokens = 42):
    # Stands in for llm.stream_chat: same (messages, usage) signature, records the
    # prompt it was handed so tests can assert on it.
    calls = []

    async def fake(messages, usage):
        calls.append(messages)
        for i, delta in enumerate(deltas):
            if fail_after is not None and i == fail_after:
                raise LLMError("boom")
            yield delta
        usage["total_tokens"] = usage_tokens

    fake.calls = calls
    return fake


def _mock_search(hits):
    # vectorstore.search is called through asyncio.to_thread, so it stays sync.
    return patch("app.core.vectorstore.search", MagicMock(return_value = hits))


def _mock_embed():
    return patch(
        "app.modules.chat.service.embed_query",
        new = AsyncMock(return_value = [0.1] * 1536),
    )


async def _ask(client, user, session, question = "What is the escalation policy?"):
    async with client.stream(
        "POST",
        f"{BASE}/messages",
        json = {"session_id": str(session.id), "content": question},
        headers = _auth(user),
    ) as resp:
        body = "".join([c async for c in resp.aiter_text()])
        status_code = resp.status_code
    return status_code, body


async def test_create_session(auth_client, db_session):
    user = await _seed_user(db_session)
    await db_session.commit()

    resp = await auth_client.post(f"{BASE}/sessions", headers = _auth(user))
    assert resp.status_code == 201
    body = resp.json()
    assert body["title"] is None
    assert body["is_active"] is True


async def test_message_streams_and_persists(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    doc = await _seed_document(db_session)
    await db_session.commit()

    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.8}]
    question = "What is the escalation policy?"
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["Esc", "alate ", "here."])
    ):
        status_code, body = await _ask(auth_client, user, session, question)

    assert status_code == 200
    events = _parse_sse(body)
    assert _tokens(events) == "Escalate here."

    done = next(d for name, d in events if name == "done")
    assert done["session_id"] == str(session.id)
    assert uuid.UUID(done["message_id"])

    rows = (await db_session.execute(
        select(ChatMessage).where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.role)
    )).scalars().all()
    assert [r.role for r in rows] == ["assistant", "user"]
    assistant = rows[0]
    assert assistant.content == "Escalate here."
    assert assistant.model_name == "gpt-4o"
    assert assistant.token_count == 42
    assert assistant.latency_ms is not None

    await db_session.refresh(session)
    assert session.title == question


async def test_title_uses_first_60_chars_and_survives_second_message(
    auth_client, db_session
):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    doc = await _seed_document(db_session)
    await db_session.commit()

    long_question = "W" * 100
    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.8}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["ok"])
    ):
        await _ask(auth_client, user, session, long_question)
        await db_session.refresh(session)
        assert session.title == "W" * 60

        await _ask(auth_client, user, session, "a different follow up question")

    # Title is set once, on the first message, and not overwritten afterwards.
    await db_session.refresh(session)
    assert session.title == "W" * 60


async def test_citations_link_real_chunks(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    doc = await _seed_document(db_session, num_chunks = 3)
    await db_session.commit()

    hits = [
        {"vector_id": f"{doc.id}:1:2", "similarity": 0.9},
        {"vector_id": f"{doc.id}:1:0", "similarity": 0.55},
    ]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["answer"])
    ):
        _, body = await _ask(auth_client, user, session, "q")

    done = next(d for name, d in _parse_sse(body) if name == "done")
    assert len(done["citations"]) == 2
    assert done["citations"][0]["chunk_index"] == 2
    assert done["citations"][0]["relevance_score"] == 0.9
    assert done["citations"][0]["document_title"] == doc.title

    seeded = {
        c.chunk_index: c.id
        for c in (await db_session.execute(
            select(DocumentChunk).where(DocumentChunk.document_id == doc.id)
        )).scalars().all()
    }
    rows = (await db_session.execute(select(ChatMessageCitation))).scalars().all()
    assert len(rows) == 2
    assert {r.document_chunk_id for r in rows} == {seeded[2], seeded[0]}


async def test_scope_excludes_non_active_version(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    # Both versions are ready and indexed, but only v2 is promoted.
    doc = await _seed_document(db_session, active_version = 2, versions = (1, 2))
    await db_session.commit()

    search = MagicMock(return_value = [{"vector_id": f"{doc.id}:2:0", "similarity": 0.8}])
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["answer"])
    ):
        await _ask(auth_client, user, session, "q")

    scope = search.call_args.args[1]
    assert scope == [(doc.id, 2)]


async def test_scope_excludes_not_ready_and_soft_deleted(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    good = await _seed_document(db_session)
    await _seed_document(db_session, status = "pending")
    await _seed_document(db_session, is_active = False)
    await _seed_document(db_session, active_version = None, versions = ())
    await db_session.commit()

    search = MagicMock(return_value = [{"vector_id": f"{good.id}:1:0", "similarity": 0.8}])
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["answer"])
    ):
        await _ask(auth_client, user, session, "q")

    scope = search.call_args.args[1]
    assert scope == [(good.id, 1)]


async def test_no_match_below_threshold_no_history(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    doc = await _seed_document(db_session)
    await db_session.commit()

    fake = _fake_stream(["should not run"])
    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.05}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", fake
    ):
        _, body = await _ask(auth_client, user, session, "how do I bake bread?")

    events = _parse_sse(body)
    assert fake.calls == []
    assert "couldn't find anything" in _tokens(events)

    done = next(d for name, d in events if name == "done")
    assert done["citations"] == []

    citations = await db_session.scalar(
        select(func.count()).select_from(ChatMessageCitation)
    )
    assert citations == 0
    assistant = (await db_session.execute(
        select(ChatMessage).where(
            ChatMessage.session_id == session.id, ChatMessage.role == "assistant"
        )
    )).scalar_one()
    assert assistant.model_name is None


async def test_low_similarity_with_history_still_answers(auth_client, db_session):
    # The regression that matters: a follow-up like "explain the second one" always
    # embeds poorly, so the cutoff alone would refuse it even though the answer is
    # sitting in the conversation.
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    doc = await _seed_document(db_session)
    db_session.add(ChatMessage(session_id = session.id, role = "user", content = "List the tiers"))
    db_session.add(ChatMessage(
        session_id = session.id, role = "assistant", content = "Tier 1, Tier 2, Tier 3"
    ))
    await db_session.commit()

    fake = _fake_stream(["Tier 2 means..."])
    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.05}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", fake
    ):
        _, body = await _ask(auth_client, user, session, "explain the second one")

    events = _parse_sse(body)
    assert _tokens(events) == "Tier 2 means..."
    assert "couldn't find anything" not in _tokens(events)

    # Weak chunks are neither sent as context nor recorded as citations.
    messages = fake.calls[0]
    assert messages[-1]["content"] == "explain the second one"
    assert "Source excerpts" not in messages[-1]["content"]
    done = next(d for name, d in events if name == "done")
    assert done["citations"] == []


async def test_llm_failure_persists_nothing(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    doc = await _seed_document(db_session)
    await db_session.commit()

    # The service rolls back, which expires this test's ORM objects, so read the id
    # out before the request rather than lazy-loading it afterwards.
    session_id = session.id
    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.8}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat",
        _fake_stream(["partial ", "answer ", "then"], fail_after = 2),
    ):
        status_code, body = await _ask(auth_client, user, session, "q")

    assert status_code == 200
    events = _parse_sse(body)
    # The learner saw two tokens before it broke — they must not be persisted.
    assert _tokens(events) == "partial answer "
    assert ("error", {"detail": "Failed to generate a response"}) in events
    assert not any(name == "done" for name, _ in events)

    count = await db_session.scalar(
        select(func.count()).select_from(ChatMessage)
        .where(ChatMessage.session_id == session_id)
    )
    assert count == 0
    await db_session.refresh(session)
    assert session.title is None


async def test_other_users_session_rejected(auth_client, db_session):
    owner = await _seed_user(db_session)
    intruder = await _seed_user(db_session)
    session = await _seed_session(db_session, owner)
    await db_session.commit()

    resp = await auth_client.post(
        f"{BASE}/messages",
        json = {"session_id": str(session.id), "content": "q"},
        headers = _auth(intruder),
    )
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Chat session not found."}

    # Same status and body as a session id that never existed — no way to probe.
    missing = await auth_client.post(
        f"{BASE}/messages",
        json = {"session_id": str(uuid.uuid4()), "content": "q"},
        headers = _auth(intruder),
    )
    assert missing.status_code == 404
    assert missing.json() == resp.json()

    count = await db_session.scalar(
        select(func.count()).select_from(ChatMessage)
        .where(ChatMessage.session_id == session.id)
    )
    assert count == 0


async def test_history_window_capped(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    doc = await _seed_document(db_session)
    # Explicit timestamps: seeded in one transaction, the now() default would give
    # all 20 rows the same created_at and the window would have nothing to order by.
    base = datetime.now(timezone.utc) - timedelta(hours = 1)
    for i in range(20):
        db_session.add(ChatMessage(
            session_id = session.id,
            role = "user" if i % 2 == 0 else "assistant",
            content = f"old message {i}",
            created_at = base + timedelta(minutes = i),
        ))
    await db_session.commit()

    fake = _fake_stream(["answer"])
    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.8}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", fake
    ):
        await _ask(auth_client, user, session, "new question")

    messages = fake.calls[0]
    # system + 6 history + the new question
    assert len(messages) == 8
    assert messages[0]["role"] == "system"
    assert messages[1]["content"] == "old message 14"
    assert messages[6]["content"] == "old message 19"
    assert "new question" in messages[7]["content"]


async def test_empty_content_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user)
    await db_session.commit()

    resp = await auth_client.post(
        f"{BASE}/messages",
        json = {"session_id": str(session.id), "content": ""},
        headers = _auth(user),
    )
    assert resp.status_code == 422


async def test_unauthenticated_rejected(auth_client):
    resp = await auth_client.post(f"{BASE}/sessions")
    assert resp.status_code == 401
