import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core.dependencies import get_db
from app.core.llm import LLMError
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.chat.models import ChatMessage, ChatMessageCitation, ChatSession
from app.modules.classes.models import Class, ClassMember
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import (
    Exercise,
    ExerciseDocument,
    Question,
    QuestionOption,
)
from app.modules.submissions.models import Submission, SubmissionAnswer

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


async def _seed_document(db, *, num_chunks = 3, status = "ready", is_active = True):
    doc = Document(
        title = f"Doc {uuid.uuid4()}",
        active_version_number = 1,
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
        mime_type = "application/pdf",
        processing_status = status,
    ))
    await db.flush()
    for i in range(num_chunks):
        db.add(DocumentChunk(
            document_id = doc.id,
            version_number = 1,
            chunk_index = i,
            content = f"chunk {i} content",
            vector_id = f"{doc.id}:1:{i}",
        ))
    await db.flush()
    return doc


# Builds an exercise sourced from `documents`, then a submission answering each
# question right or wrong per `results`: True = correct, False = wrong, None =
# skipped. Mirrors ExamService.generate(): the sources are always recorded in
# exercise_documents, but per-question provenance is only set with a single source.
async def _seed_submission(db, user, documents, results, *, num_options = 2):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    db.add(ClassMember(class_id = cls.id, user_id = user.id))

    now = datetime.now(timezone.utc)
    exercise = Exercise(
        class_id = cls.id,
        title = "Onboarding Basics",
        start_time = now - timedelta(hours = 2),
        end_time = now - timedelta(hours = 1),
        duration_minutes = 60,
        pass_score = 1,
        total_points = len(results),
    )
    db.add(exercise)
    await db.flush()

    for document in documents:
        db.add(ExerciseDocument(
            exercise_id = exercise.id,
            document_id = document.id,
            version_number = 1,
        ))
    await db.flush()

    # Only a single source is attributable per question, same rule as generate().
    src_doc = documents[0].id if len(documents) == 1 else None
    src_ver = 1 if len(documents) == 1 else None

    questions = []
    # Options are tracked here rather than read back off question.options — the
    # relationship would lazy-load outside the greenlet context.
    options_by_question = {}
    for i in range(len(results)):
        question = Question(
            exercise_id = exercise.id,
            source_document_id = src_doc,
            source_version_number = src_ver,
            question_text = f"Question text {i}",
            explanation = f"Author note {i}",
            points = 1,
            order_index = i,
        )
        db.add(question)
        await db.flush()
        options = []
        for j in range(num_options):
            option = QuestionOption(
                question_id = question.id,
                option_label = "ABCDEFGHIJ"[j],
                option_text = f"q{i} option {j}",
                is_correct = (j == 0),
            )
            db.add(option)
            options.append(option)
        await db.flush()
        questions.append(question)
        options_by_question[question.id] = options

    submission = Submission(
        user_id = user.id,
        exercise_id = exercise.id,
        attempt_number = 1,
        submitted_at = now,
        score = sum(1 for r in results if r is True),
    )
    db.add(submission)
    await db.flush()

    for question, correct in zip(questions, results):
        options = options_by_question[question.id]
        if correct is None:
            selected_option_id = None
        else:
            selected_option_id = options[0].id if correct else options[1].id
        db.add(SubmissionAnswer(
            submission_id = submission.id,
            question_id = question.id,
            selected_option_id = selected_option_id,
            is_correct = correct,
            points_earned = 1 if correct else 0,
        ))
    await db.flush()
    return submission, exercise


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


async def _explain(client, user, submission_id):
    async with client.stream(
        "POST",
        f"{BASE}/explain",
        json = {"submission_id": str(submission_id)},
        headers = _auth(user),
    ) as resp:
        body = "".join([c async for c in resp.aiter_text()])
        status_code = resp.status_code
    return status_code, body


async def test_explain_streams_and_persists(auth_client, db_session):
    user = await _seed_user(db_session)
    doc = await _seed_document(db_session)
    submission, exercise = await _seed_submission(
        db_session, user, [doc], [True, False, False]
    )
    await db_session.commit()

    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.7}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["You ", "missed ", "these."])
    ):
        status_code, body = await _explain(auth_client, user, submission.id)

    assert status_code == 200
    events = _parse_sse(body)
    assert _tokens(events) == "You missed these."

    done = next(d for name, d in events if name == "done")
    assert uuid.UUID(done["message_id"])
    assert len(done["citations"]) == 1
    assert done["citations"][0]["document_id"] == str(doc.id)

    # The endpoint creates the session itself and pins it to the exam, so follow-up
    # questions re-derive the same sources however many documents fed it.
    session = (await db_session.execute(
        select(ChatSession).where(ChatSession.id == uuid.UUID(done["session_id"]))
    )).scalar_one()
    assert session.user_id == user.id
    assert session.exercise_id == exercise.id
    assert session.document_id is None

    rows = (await db_session.execute(
        select(ChatMessage).where(ChatMessage.session_id == session.id)
        .order_by(ChatMessage.created_at)
    )).scalars().all()
    assert [r.role for r in rows] == ["user", "assistant"]
    assert rows[1].content == "You missed these."
    assert rows[1].model_name == "gpt-4o"

    citations = await db_session.scalar(
        select(func.count()).select_from(ChatMessageCitation)
    )
    assert citations == 1


async def test_explain_prompt_covers_only_wrong_questions(auth_client, db_session):
    user = await _seed_user(db_session)
    doc = await _seed_document(db_session)
    # Question 0 correct, question 1 wrong, question 2 skipped.
    submission, questions = await _seed_submission(
        db_session, user, [doc], [True, False, None]
    )
    await db_session.commit()

    fake = _fake_stream(["ok"])
    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.7}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", fake
    ):
        await _explain(auth_client, user, submission.id)

    prompt = fake.calls[0][-1]["content"]
    assert "Question text 0" not in prompt
    assert "Question text 1" in prompt
    assert "Question text 2" in prompt
    # The wrong answer shows what was picked; the skipped one says so explicitly.
    assert "My answer: B. q1 option 1" in prompt
    assert "My answer: (not answered)" in prompt
    assert "Correct answer: A. q1 option 0" in prompt
    assert "Author's note: Author note 1" in prompt
    assert "Onboarding Basics" in prompt


async def test_explain_scope_comes_from_exam_sources(auth_client, db_session):
    user = await _seed_user(db_session)
    source = await _seed_document(db_session)
    # A second live document that must not be searched.
    await _seed_document(db_session)
    submission, _ = await _seed_submission(db_session, user, [source], [False])
    await db_session.commit()

    search = MagicMock(return_value = [{"vector_id": f"{source.id}:1:0", "similarity": 0.7}])
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["ok"])
    ):
        await _explain(auth_client, user, submission.id)

    assert search.call_args.args[1] == [(source.id, 1)]
    # Retrieval is per question, not one blurred embedding of all of them.
    assert search.call_args.args[2] == 3


async def test_explain_multi_document_exam_covers_every_source(auth_client, db_session):
    # The regression that matters: a multi-document exam leaves per-question
    # provenance null, so scope has to come from exercise_documents or retrieval
    # silently returns nothing.
    user = await _seed_user(db_session)
    first = await _seed_document(db_session)
    second = await _seed_document(db_session)
    # A third live document that is not part of the exam.
    outsider = await _seed_document(db_session)
    submission, exercise = await _seed_submission(
        db_session, user, [first, second], [False]
    )
    await db_session.commit()

    search = MagicMock(return_value = [{"vector_id": f"{first.id}:1:0", "similarity": 0.7}])
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["ok"])
    ):
        _, body = await _explain(auth_client, user, submission.id)

    scope = search.call_args.args[1]
    assert set(scope) == {(first.id, 1), (second.id, 1)}
    assert (outsider.id, 1) not in scope

    # Per-question provenance really is null here — the scope came from the exam.
    questions = (await db_session.execute(
        select(Question).where(Question.exercise_id == exercise.id)
    )).scalars().all()
    assert all(q.source_document_id is None for q in questions)

    done = next(d for name, d in _parse_sse(body) if name == "done")
    assert len(done["citations"]) == 1


async def test_followup_in_explain_session_keeps_exam_scope(auth_client, db_session):
    user = await _seed_user(db_session)
    first = await _seed_document(db_session)
    second = await _seed_document(db_session)
    await _seed_document(db_session)
    submission, _ = await _seed_submission(db_session, user, [first, second], [False])
    await db_session.commit()

    hits = [{"vector_id": f"{first.id}:1:0", "similarity": 0.7}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["ok"])
    ):
        _, body = await _explain(auth_client, user, submission.id)
    session_id = next(d for name, d in _parse_sse(body) if name == "done")["session_id"]

    # The follow-up carries only a session_id, so the stored exercise is the only
    # thing keeping it off the rest of the corpus.
    search = MagicMock(return_value = hits)
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["more"])
    ):
        async with auth_client.stream(
            "POST",
            f"{BASE}/messages",
            json = {"session_id": session_id, "content": "giải thích kỹ hơn"},
            headers = _auth(user),
        ) as resp:
            assert resp.status_code == 200
            async for _ in resp.aiter_text():
                pass

    assert set(search.call_args.args[1]) == {(first.id, 1), (second.id, 1)}


async def test_explain_skips_soft_deleted_source_document(auth_client, db_session):
    user = await _seed_user(db_session)
    hidden = await _seed_document(db_session, is_active = False)
    submission, _ = await _seed_submission(db_session, user, [hidden], [False])
    await db_session.commit()

    search = MagicMock(return_value = [])
    with _mock_embed(), patch("app.core.vectorstore.search", search), patch(
        "app.modules.chat.service.stream_chat", _fake_stream(["ok"])
    ):
        _, body = await _explain(auth_client, user, submission.id)

    # Empty scope short-circuits before Chroma is touched at all.
    assert search.call_args is None
    done = next(d for name, d in _parse_sse(body) if name == "done")
    assert done["citations"] == []


async def test_explain_without_provenance_still_answers(auth_client, db_session):
    user = await _seed_user(db_session)
    submission, exercise = await _seed_submission(db_session, user, [], [False, False])
    await db_session.commit()

    fake = _fake_stream(["Explained from the question itself."])
    with _mock_embed(), _mock_search([]), patch(
        "app.modules.chat.service.stream_chat", fake
    ):
        status_code, body = await _explain(auth_client, user, submission.id)

    assert status_code == 200
    events = _parse_sse(body)
    assert _tokens(events) == "Explained from the question itself."
    done = next(d for name, d in events if name == "done")
    assert done["citations"] == []

    # Still pinned to the exam, but the exam recorded no sources, so scope is empty.
    session = (await db_session.execute(
        select(ChatSession).where(ChatSession.id == uuid.UUID(done["session_id"]))
    )).scalar_one()
    assert session.exercise_id == exercise.id
    assert session.document_id is None

    prompt = fake.calls[0][-1]["content"]
    assert "Source excerpts" not in prompt


async def test_explain_caps_questions_and_says_so(auth_client, db_session):
    user = await _seed_user(db_session)
    doc = await _seed_document(db_session)
    submission, _ = await _seed_submission(db_session, user, [doc], [False] * 14)
    await db_session.commit()

    fake = _fake_stream(["ok"])
    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.7}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", fake
    ):
        _, body = await _explain(auth_client, user, submission.id)

    prompt = fake.calls[0][-1]["content"]
    assert "Question 10:" in prompt
    assert "Question 11:" not in prompt
    caveat = "(I got 14 questions wrong; only the first 10 are listed here.)"
    assert caveat in prompt

    # The caveat is part of the persisted message, not just the prompt.
    done = next(d for name, d in _parse_sse(body) if name == "done")
    user_message = (await db_session.execute(
        select(ChatMessage).where(
            ChatMessage.session_id == uuid.UUID(done["session_id"]),
            ChatMessage.role == "user",
        )
    )).scalar_one()
    assert caveat in user_message.content


async def test_explain_no_caveat_when_nothing_truncated(auth_client, db_session):
    user = await _seed_user(db_session)
    doc = await _seed_document(db_session)
    submission, _ = await _seed_submission(db_session, user, [doc], [False] * 10)
    await db_session.commit()

    fake = _fake_stream(["ok"])
    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.7}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat", fake
    ):
        await _explain(auth_client, user, submission.id)

    prompt = fake.calls[0][-1]["content"]
    assert "Question 10:" in prompt
    assert "questions wrong; only the first" not in prompt


async def test_explain_all_correct_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    doc = await _seed_document(db_session)
    submission, _ = await _seed_submission(db_session, user, [doc], [True, True])
    await db_session.commit()

    resp = await auth_client.post(
        f"{BASE}/explain",
        json = {"submission_id": str(submission.id)},
        headers = _auth(user),
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "This submission has no incorrect answers."}


async def test_explain_other_users_submission_rejected(auth_client, db_session):
    owner = await _seed_user(db_session)
    intruder = await _seed_user(db_session)
    doc = await _seed_document(db_session)
    submission, _ = await _seed_submission(db_session, owner, [doc], [False])
    await db_session.commit()

    resp = await auth_client.post(
        f"{BASE}/explain",
        json = {"submission_id": str(submission.id)},
        headers = _auth(intruder),
    )
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Submission not found."}

    # Same status and body as an id that never existed — no way to probe.
    missing = await auth_client.post(
        f"{BASE}/explain",
        json = {"submission_id": str(uuid.uuid4())},
        headers = _auth(intruder),
    )
    assert missing.status_code == 404
    assert missing.json() == resp.json()

    count = await db_session.scalar(select(func.count()).select_from(ChatSession))
    assert count == 0


async def test_explain_llm_failure_persists_nothing(auth_client, db_session):
    user = await _seed_user(db_session)
    doc = await _seed_document(db_session)
    submission, _ = await _seed_submission(db_session, user, [doc], [False])
    await db_session.commit()

    hits = [{"vector_id": f"{doc.id}:1:0", "similarity": 0.7}]
    with _mock_embed(), _mock_search(hits), patch(
        "app.modules.chat.service.stream_chat",
        _fake_stream(["partial ", "answer ", "then"], fail_after = 2),
    ):
        status_code, body = await _explain(auth_client, user, submission.id)

    assert status_code == 200
    events = _parse_sse(body)
    assert _tokens(events) == "partial answer "
    assert ("error", {"detail": "Failed to generate a response"}) in events
    assert not any(name == "done" for name, _ in events)

    # The session was only flushed, so the rollback takes it with the messages.
    sessions = await db_session.scalar(select(func.count()).select_from(ChatSession))
    assert sessions == 0
    messages = await db_session.scalar(select(func.count()).select_from(ChatMessage))
    assert messages == 0


async def test_explain_embedding_failure_returns_502(auth_client, db_session):
    user = await _seed_user(db_session)
    doc = await _seed_document(db_session)
    submission, _ = await _seed_submission(db_session, user, [doc], [False])
    await db_session.commit()

    with patch(
        "app.modules.chat.service.embed_query",
        new = AsyncMock(side_effect = LLMError("boom")),
    ):
        resp = await auth_client.post(
            f"{BASE}/explain",
            json = {"submission_id": str(submission.id)},
            headers = _auth(user),
        )

    assert resp.status_code == 502
    assert resp.json() == {"detail": "Failed to search the documents"}


async def test_explain_unauthenticated_rejected(auth_client):
    resp = await auth_client.post(
        f"{BASE}/explain", json = {"submission_id": str(uuid.uuid4())}
    )
    assert resp.status_code == 401
