import uuid
from unittest.mock import AsyncMock, patch

from sqlalchemy import func, select

from app.core.dependencies import require_admin
from app.core.llm import GeneratedQuestion
from app.main import app
from app.modules.classes.models import Class
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import Exercise, Question, QuestionOption

BASE = "/api/v1/exams"


def _use_stub_admin():
    # The shared fixture stubs require_admin as a dict, but generate reads
    # current_user.id — override with a minimal user (created_by is nullable).
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()


async def _seed_class(db):
    c = Class(name = f"Class {uuid.uuid4()}")
    db.add(c)
    await db.flush()
    return c


async def _seed_document(db, *, num_chunks = 3, active_version = 1, status = "ready"):
    doc = Document(title = f"Doc {uuid.uuid4()}", active_version_number = active_version)
    db.add(doc)
    await db.flush()
    if active_version is not None:
        db.add(DocumentVersion(
            document_id = doc.id,
            version_number = active_version,
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
                version_number = active_version,
                chunk_index = i,
                content = f"chunk {i} content",
            ))
        await db.flush()
    return doc


def _fake_questions(n, options = 4, correct_index = 1):
    return [
        GeneratedQuestion(
            question_text = f"Question {i}?",
            explanation = "Because the source says so.",
            options = [f"Option {j}" for j in range(options)],
            correct_index = correct_index,
        )
        for i in range(n)
    ]


def _mock_generate(questions):
    return patch(
        "app.modules.exams.service.generate_quiz",
        new = AsyncMock(return_value = questions),
    )


async def _generate(client, db, *, num_questions = 3):
    _use_stub_admin()
    cls = await _seed_class(db)
    doc = await _seed_document(db)
    with _mock_generate(_fake_questions(num_questions)):
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Quiz A",
            "class_id": str(cls.id),
            "document_id": str(doc.id),
            "num_questions": num_questions,
            "prompt": "Cover the basics",
        })
    return doc, resp


async def test_generate_happy_path(client, db_session):
    doc, resp = await _generate(client, db_session, num_questions = 3)
    assert resp.status_code == 201
    body = resp.json()

    assert body["is_active"] is False
    assert body["total_points"] == 3
    assert len(body["questions"]) == 3
    assert body["chunks_used"] == 3
    assert body["chunks_total"] == 3

    for q in body["questions"]:
        assert len(q["options"]) == 4
        assert sum(1 for o in q["options"] if o["is_correct"]) == 1

    # Provenance must be populated — nothing else would catch a null source.
    rows = (await db_session.execute(
        select(Question).where(Question.source_document_id == doc.id)
    )).scalars().all()
    assert len(rows) == 3
    assert all(r.source_version_number == 1 for r in rows)


async def test_generate_no_active_version_rejected(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, active_version = None)
    with _mock_generate(_fake_questions(3)):
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Q",
            "class_id": str(cls.id),
            "document_id": str(doc.id),
            "num_questions": 3,
            "prompt": "x",
        })
    assert resp.status_code == 400
    count = await db_session.scalar(select(func.count()).select_from(Exercise))
    assert count == 0


async def test_generate_version_not_ready_rejected(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, status = "pending")
    with _mock_generate(_fake_questions(3)):
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Q",
            "class_id": str(cls.id),
            "document_id": str(doc.id),
            "num_questions": 3,
            "prompt": "x",
        })
    assert resp.status_code == 400
    count = await db_session.scalar(select(func.count()).select_from(Exercise))
    assert count == 0


async def test_generate_wrong_count_saves_nothing(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session)
    # Asked for 3 but the generator returns 2 — reject the whole batch.
    with _mock_generate(_fake_questions(2)):
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Q",
            "class_id": str(cls.id),
            "document_id": str(doc.id),
            "num_questions": 3,
            "prompt": "x",
        })
    assert resp.status_code == 502
    count = await db_session.scalar(select(func.count()).select_from(Exercise))
    assert count == 0


async def test_generate_bad_correct_index_saves_nothing(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session)
    with _mock_generate(_fake_questions(2, correct_index = 9)):
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Q",
            "class_id": str(cls.id),
            "document_id": str(doc.id),
            "num_questions": 2,
            "prompt": "x",
        })
    assert resp.status_code == 502
    count = await db_session.scalar(select(func.count()).select_from(Exercise))
    assert count == 0


async def test_generate_reports_partial_chunk_coverage(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    doc = await _seed_document(db_session, num_chunks = 5)
    with patch("app.modules.exams.service.MAX_CONTEXT_CHUNKS", 2), \
         _mock_generate(_fake_questions(2)):
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Q",
            "class_id": str(cls.id),
            "document_id": str(doc.id),
            "num_questions": 2,
            "prompt": "x",
        })
    assert resp.status_code == 201
    body = resp.json()
    assert body["chunks_total"] == 5
    assert body["chunks_used"] == 2


async def test_get_exercise(client, db_session):
    _, resp = await _generate(client, db_session, num_questions = 2)
    exercise_id = resp.json()["id"]
    got = await client.get(f"{BASE}/{exercise_id}")
    assert got.status_code == 200
    assert len(got.json()["questions"]) == 2
    assert got.json()["chunks_total"] == 3


async def test_update_question(client, db_session):
    _, resp = await _generate(client, db_session, num_questions = 1)
    question_id = resp.json()["questions"][0]["id"]
    patched = await client.patch(
        f"{BASE}/questions/{question_id}", json = {"question_text": "Edited?"}
    )
    assert patched.status_code == 200
    assert patched.json()["question_text"] == "Edited?"


async def test_update_option_repoints_correct(client, db_session):
    _, resp = await _generate(client, db_session, num_questions = 1)
    question = resp.json()["questions"][0]
    wrong = next(o for o in question["options"] if not o["is_correct"])
    patched = await client.patch(
        f"{BASE}/questions/{question['id']}/options/{wrong['id']}",
        json = {"is_correct": True},
    )
    assert patched.status_code == 200
    options = patched.json()["options"]
    assert sum(1 for o in options if o["is_correct"]) == 1
    assert next(o for o in options if o["id"] == wrong["id"])["is_correct"] is True


async def test_update_option_cannot_leave_zero_correct(client, db_session):
    _, resp = await _generate(client, db_session, num_questions = 1)
    question = resp.json()["questions"][0]
    correct = next(o for o in question["options"] if o["is_correct"])
    patched = await client.patch(
        f"{BASE}/questions/{question['id']}/options/{correct['id']}",
        json = {"is_correct": False},
    )
    assert patched.status_code == 400
    # DB unchanged — the option is still correct.
    row = await db_session.get(QuestionOption, uuid.UUID(correct["id"]))
    await db_session.refresh(row)
    assert row.is_correct is True
