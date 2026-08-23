import uuid
from unittest.mock import AsyncMock, patch

from app.core.dependencies import require_admin
from app.core.llm import GeneratedQuestion
from app.main import app
from app.modules.classes.models import Class
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from tests.conftest import auth_header, seed_auth_user

BASE = "/api/v1/exams"


def _use_stub_admin():
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()


async def _seed_class(db):
    c = Class(name = f"Class {uuid.uuid4()}")
    db.add(c)
    await db.flush()
    return c


async def _seed_document(db, *, num_chunks = 3):
    doc = Document(title = f"Doc {uuid.uuid4()}", active_version_number = 1)
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
    for i in range(num_chunks):
        db.add(DocumentChunk(
            document_id = doc.id,
            version_number = 1,
            chunk_index = i,
            content = f"chunk {i} content",
        ))
    await db.flush()
    return doc


def _fake_questions(n):
    return [
        GeneratedQuestion(
            question_text = f"Question {i}?",
            explanation = "Because the source says so.",
            options = [f"Option {j}" for j in range(4)],
            correct_index = 1,
        )
        for i in range(n)
    ]


async def _make_draft(client, db, *, prompt = "Cover the basics"):
    _use_stub_admin()
    cls = await _seed_class(db)
    doc = await _seed_document(db)
    body = {
        "title": "Original title",
        "class_id": str(cls.id),
        "document_ids": [str(doc.id)],
        "num_questions": 3,
    }
    if prompt is not None:
        body["prompt"] = prompt
    with patch(
        "app.modules.exams.service.generate_quiz",
        new = AsyncMock(return_value = _fake_questions(3)),
    ) as mock:
        resp = await client.post(f"{BASE}/generate", json = body)
    return resp, mock


async def _finalize(client, exercise_id):
    return await client.put(f"{BASE}/{exercise_id}/finalize", json = {
        "start_time": "2026-01-01T09:00:00Z",
        "end_time": "2026-01-02T09:00:00Z",
        "duration_minutes": 30,
        "pass_score": 1,
    })


# --- PATCH /exams/{id} ---------------------------------------------------


async def test_rename_draft(client, db_session):
    resp, _ = await _make_draft(client, db_session)
    exercise_id = resp.json()["id"]

    patched = await client.patch(f"{BASE}/{exercise_id}", json = {"title": "Renamed"})
    assert patched.status_code == 200
    assert patched.json()["title"] == "Renamed"

    # Persisted, not just echoed back.
    fetched = await client.get(f"{BASE}/{exercise_id}")
    assert fetched.json()["title"] == "Renamed"


async def test_rename_leaves_the_questions_alone(client, db_session):
    resp, _ = await _make_draft(client, db_session)
    body = resp.json()
    exercise_id = body["id"]

    patched = await client.patch(f"{BASE}/{exercise_id}", json = {"title": "Renamed"})
    assert len(patched.json()["questions"]) == len(body["questions"])


async def test_rename_rejected_once_finalized(client, db_session):
    resp, _ = await _make_draft(client, db_session)
    exercise_id = resp.json()["id"]
    assert (await _finalize(client, exercise_id)).status_code == 200

    patched = await client.patch(f"{BASE}/{exercise_id}", json = {"title": "Too late"})
    assert patched.status_code == 409
    assert patched.json()["detail"] == "Cannot edit a finalized exercise"

    # And nothing changed.
    fetched = await client.get(f"{BASE}/{exercise_id}")
    assert fetched.json()["title"] == "Original title"


async def test_rename_unknown_exercise_404s(client, db_session):
    resp = await client.patch(f"{BASE}/{uuid.uuid4()}", json = {"title": "Nope"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Exercise not found"


async def test_rename_rejects_a_blank_title(client, db_session):
    resp, _ = await _make_draft(client, db_session)
    exercise_id = resp.json()["id"]

    patched = await client.patch(f"{BASE}/{exercise_id}", json = {"title": ""})
    assert patched.status_code == 422


async def test_rename_requires_authentication(auth_client, db_session):
    resp = await auth_client.patch(f"{BASE}/{uuid.uuid4()}", json = {"title": "X"})
    assert resp.status_code == 401


async def test_rename_rejects_a_learner(auth_client, db_session):
    learner = await seed_auth_user(db_session, role = "learner")
    resp = await auth_client.patch(
        f"{BASE}/{uuid.uuid4()}",
        json = {"title": "X"},
        headers = auth_header(learner),
    )
    assert resp.status_code == 403


# --- optional prompt -----------------------------------------------------


async def test_generate_accepts_an_empty_prompt(client, db_session):
    resp, mock = await _make_draft(client, db_session, prompt = "")
    assert resp.status_code == 201
    assert len(resp.json()["questions"]) == 3

    # An empty instruction is replaced, never passed through as "" — the model
    # would otherwise get a dangling "Admin instructions:" line.
    assert mock.await_args.args[1] == "Cover the main points of the source material evenly."


async def test_generate_accepts_an_omitted_prompt(client, db_session):
    resp, mock = await _make_draft(client, db_session, prompt = None)
    assert resp.status_code == 201
    assert mock.await_args.args[1] == "Cover the main points of the source material evenly."


async def test_generate_accepts_a_whitespace_only_prompt(client, db_session):
    resp, mock = await _make_draft(client, db_session, prompt = "   ")
    assert resp.status_code == 201
    assert mock.await_args.args[1] == "Cover the main points of the source material evenly."


async def test_a_real_prompt_is_passed_through_untouched(client, db_session):
    resp, mock = await _make_draft(client, db_session, prompt = "Focus on escalation")
    assert resp.status_code == 201
    assert mock.await_args.args[1] == "Focus on escalation"
