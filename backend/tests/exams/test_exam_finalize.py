import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

from app.core.dependencies import require_admin
from app.core.llm import GeneratedQuestion
from app.main import app
from app.modules.classes.models import Class
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import Exercise

BASE = "/api/v1/exams"

START = "2026-08-01T09:00:00+00:00"
END = "2026-08-01T11:00:00+00:00"


def _finalize_body(*, start = START, end = END, duration = 60, pass_score = 2):
    return {
        "start_time": start,
        "end_time": end,
        "duration_minutes": duration,
        "pass_score": pass_score,
    }


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


async def _generate_draft(client, db, *, num_questions = 3):
    _use_stub_admin()
    cls = await _seed_class(db)
    doc = await _seed_document(db)
    with patch(
        "app.modules.exams.service.generate_quiz",
        new = AsyncMock(return_value = _fake_questions(num_questions)),
    ):
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Quiz A",
            "class_id": str(cls.id),
            "document_id": str(doc.id),
            "num_questions": num_questions,
            "prompt": "Cover the basics",
        })
    assert resp.status_code == 201
    return resp.json()


async def test_finalize_happy_path_recomputes_total_points(client, db_session):
    draft = await _generate_draft(client, db_session, num_questions = 3)
    exercise_id = draft["id"]

    # Change one question's points so the stored total_points (3) is stale;
    # finalize must recompute from the current questions -> 5 + 1 + 1 = 7.
    question_id = draft["questions"][0]["id"]
    patched = await client.patch(
        f"{BASE}/questions/{question_id}", json = {"points": 5}
    )
    assert patched.status_code == 200

    resp = await client.put(
        f"{BASE}/{exercise_id}/finalize", json = _finalize_body(pass_score = 4)
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_active"] is True
    assert body["total_points"] == 7

    row = await db_session.get(Exercise, uuid.UUID(exercise_id))
    await db_session.refresh(row)
    assert row.is_active is True
    assert row.total_points == 7
    assert row.duration_minutes == 60
    assert row.pass_score == 4
    assert row.start_time.isoformat() == START


async def test_finalize_start_after_end_rejected(client, db_session):
    draft = await _generate_draft(client, db_session, num_questions = 3)
    exercise_id = draft["id"]

    resp = await client.put(
        f"{BASE}/{exercise_id}/finalize",
        json = _finalize_body(start = END, end = START),
    )
    assert resp.status_code == 400

    row = await db_session.get(Exercise, uuid.UUID(exercise_id))
    await db_session.refresh(row)
    assert row.is_active is False


async def test_finalize_zero_duration_rejected(client, db_session):
    draft = await _generate_draft(client, db_session, num_questions = 3)
    exercise_id = draft["id"]

    resp = await client.put(
        f"{BASE}/{exercise_id}/finalize", json = _finalize_body(duration = 0)
    )
    assert resp.status_code == 400

    row = await db_session.get(Exercise, uuid.UUID(exercise_id))
    await db_session.refresh(row)
    assert row.is_active is False


async def test_finalize_zero_questions_rejected(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    exercise = Exercise(
        title = "Empty",
        class_id = cls.id,
        start_time = datetime.fromisoformat(START),
        end_time = datetime.fromisoformat(END),
        duration_minutes = 60,
        pass_score = 0,
        total_points = 0,
        is_active = False,
    )
    db_session.add(exercise)
    await db_session.flush()

    resp = await client.put(
        f"{BASE}/{exercise.id}/finalize", json = _finalize_body(pass_score = 0)
    )
    assert resp.status_code == 400

    await db_session.refresh(exercise)
    assert exercise.is_active is False


async def test_refinalize_rejected(client, db_session):
    draft = await _generate_draft(client, db_session, num_questions = 3)
    exercise_id = draft["id"]

    first = await client.put(
        f"{BASE}/{exercise_id}/finalize", json = _finalize_body(pass_score = 2)
    )
    assert first.status_code == 200

    second = await client.put(
        f"{BASE}/{exercise_id}/finalize", json = _finalize_body(pass_score = 1)
    )
    assert second.status_code == 409


async def test_finalize_pass_score_exceeds_total_rejected(client, db_session):
    draft = await _generate_draft(client, db_session, num_questions = 3)
    exercise_id = draft["id"]

    # Total points is 3; a pass_score above that must be rejected before commit.
    resp = await client.put(
        f"{BASE}/{exercise_id}/finalize", json = _finalize_body(pass_score = 4)
    )
    assert resp.status_code == 400

    row = await db_session.get(Exercise, uuid.UUID(exercise_id))
    await db_session.refresh(row)
    assert row.is_active is False
