import uuid
from unittest.mock import patch

from sqlalchemy import func, select

from app.modules.exams.models import Exercise, ExerciseGenerationJob
from tests.exams.helpers import (
    BASE,
    seed_class,
    seed_document,
    seed_draft,
    seed_draft_rows,
    use_stub_admin,
)

# Generation runs in the Celery worker, so this file covers the request path only:
# what is validated before a job is written, what the 202 returns, and what the job
# row records. The run itself is tested in test_exam_generation_worker.py.


def _mock_enqueue():
    return patch("worker.tasks.generate_exercise")


async def _post(client, cls, docs, *, num_questions = 3, prompt = "Cover the basics"):
    return await client.post(f"{BASE}/generate", json = {
        "title": "Quiz A",
        "class_id": str(cls.id),
        "document_ids": [str(d.id) for d in docs],
        "num_questions": num_questions,
        "prompt": prompt,
    })


# --- accepted requests ---------------------------------------------------


async def test_generate_accepts_and_returns_a_queued_job(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc = await seed_document(db_session)

    with _mock_enqueue() as task:
        resp = await _post(client, cls, [doc], num_questions = 5)

    # 202, not 201: nothing has been generated yet.
    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "queued"
    assert body["questions_done"] == 0
    assert body["num_questions"] == 5
    assert body["exercise_id"] is None
    assert body["error"] is None
    assert body["finished_at"] is None

    # Handed to the worker exactly once, by id.
    task.delay.assert_called_once_with(body["id"])

    job = await db_session.get(ExerciseGenerationJob, uuid.UUID(body["id"]))
    assert job.title == "Quiz A"
    assert job.document_ids == [str(doc.id)]
    assert job.class_id == cls.id

    # The request path must not create an exercise — that is the worker's job,
    # in one commit, only on success.
    count = await db_session.scalar(select(func.count()).select_from(Exercise))
    assert count == 0


async def test_generate_dedupes_document_ids_preserving_order(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc1 = await seed_document(db_session)
    doc2 = await seed_document(db_session)

    with _mock_enqueue():
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Quiz A",
            "class_id": str(cls.id),
            "document_ids": [str(doc1.id), str(doc2.id), str(doc1.id)],
            "num_questions": 2,
            "prompt": "x",
        })

    assert resp.status_code == 202
    job = await db_session.get(ExerciseGenerationJob, uuid.UUID(resp.json()["id"]))
    assert job.document_ids == [str(doc1.id), str(doc2.id)]


# The prompt is stored verbatim; substituting the neutral default is the worker's
# job (covered in test_exam_generation_worker.py), not the request path's.
async def test_generate_stores_the_prompt_verbatim(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc = await seed_document(db_session)

    for prompt in ("", "   ", "Focus on escalation"):
        with _mock_enqueue():
            resp = await _post(client, cls, [doc], prompt = prompt)
        assert resp.status_code == 202
        job = await db_session.get(ExerciseGenerationJob, uuid.UUID(resp.json()["id"]))
        assert job.prompt == prompt


async def test_generate_accepts_an_omitted_prompt(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc = await seed_document(db_session)

    with _mock_enqueue():
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Quiz A",
            "class_id": str(cls.id),
            "document_ids": [str(doc.id)],
            "num_questions": 3,
        })

    assert resp.status_code == 202
    job = await db_session.get(ExerciseGenerationJob, uuid.UUID(resp.json()["id"]))
    assert job.prompt == ""


# --- rejected before anything is written ---------------------------------


async def test_generate_unknown_class_rejected(client, db_session):
    use_stub_admin()
    doc = await seed_document(db_session)

    with _mock_enqueue() as task:
        resp = await client.post(f"{BASE}/generate", json = {
            "title": "Q",
            "class_id": str(uuid.uuid4()),
            "document_ids": [str(doc.id)],
            "num_questions": 3,
            "prompt": "x",
        })

    assert resp.status_code == 404
    assert resp.json() == {"detail": "Class not found"}
    task.delay.assert_not_called()
    assert await db_session.scalar(
        select(func.count()).select_from(ExerciseGenerationJob)
    ) == 0


async def test_generate_no_active_version_rejected(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc = await seed_document(db_session, active_version = None)

    with _mock_enqueue() as task:
        resp = await _post(client, cls, [doc])

    assert resp.status_code == 400
    assert resp.json() == {"detail": "Document has no active version"}
    task.delay.assert_not_called()
    assert await db_session.scalar(
        select(func.count()).select_from(ExerciseGenerationJob)
    ) == 0


async def test_generate_version_not_ready_rejected(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc = await seed_document(db_session, status = "pending")

    with _mock_enqueue() as task:
        resp = await _post(client, cls, [doc])

    assert resp.status_code == 400
    assert resp.json() == {"detail": "Document active version is not ready"}
    task.delay.assert_not_called()


async def test_generate_no_content_rejected(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc = await seed_document(db_session, num_chunks = 0)

    with _mock_enqueue() as task:
        resp = await _post(client, cls, [doc])

    assert resp.status_code == 400
    assert resp.json() == {"detail": "Document active version has no content"}
    task.delay.assert_not_called()


async def test_generate_multi_document_one_not_ready_rejected(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc1 = await seed_document(db_session)
    doc2 = await seed_document(db_session, status = "pending")

    with _mock_enqueue() as task:
        resp = await _post(client, cls, [doc1, doc2], num_questions = 2)

    assert resp.status_code == 400
    task.delay.assert_not_called()
    assert await db_session.scalar(
        select(func.count()).select_from(ExerciseGenerationJob)
    ) == 0


# --- broker down ---------------------------------------------------------


async def test_enqueue_failure_fails_the_job_immediately(client, db_session):
    # A document version left "pending" can be retried through reprocess_version;
    # a job has no such path, so leaving it queued would strand the admin watching
    # a queue that will never move.
    use_stub_admin()
    cls = await seed_class(db_session)
    doc = await seed_document(db_session)

    with patch("worker.tasks.generate_exercise") as task:
        task.delay.side_effect = OSError("broker is down")
        resp = await _post(client, cls, [doc])

    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "failed"
    assert body["error"] == "Could not queue generation. Try again."
    assert body["finished_at"] is not None
    assert body["exercise_id"] is None


# --- GET /exams/jobs/{job_id} --------------------------------------------


async def test_get_job_reports_progress(client, db_session):
    use_stub_admin()
    cls = await seed_class(db_session)
    doc = await seed_document(db_session)

    with _mock_enqueue():
        created = await _post(client, cls, [doc], num_questions = 10)
    job_id = created.json()["id"]

    # Stand in for the worker having finished two batches.
    job = await db_session.get(ExerciseGenerationJob, uuid.UUID(job_id))
    job.status = "running"
    job.questions_done = 2
    await db_session.commit()

    resp = await client.get(f"{BASE}/jobs/{job_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "running"
    assert resp.json()["questions_done"] == 2
    assert resp.json()["num_questions"] == 10


async def test_get_job_unknown_id_404(client, db_session):
    use_stub_admin()
    resp = await client.get(f"{BASE}/jobs/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Generation job not found"}


# The jobs route is declared before /{exercise_id}, which would otherwise match
# "jobs" and reject it as a malformed UUID.
async def test_jobs_route_is_not_shadowed_by_the_exercise_route(client, db_session):
    use_stub_admin()
    resp = await client.get(f"{BASE}/jobs/{uuid.uuid4()}")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Generation job not found"}


# --- reads on a generated draft ------------------------------------------


async def test_get_exercise_reports_chunk_coverage(client, db_session):
    use_stub_admin()
    doc = await seed_document(db_session, num_chunks = 5)
    exercise, _, _ = await seed_draft_rows(db_session, num_questions = 2, doc = doc)

    with patch("app.modules.exams.service.MAX_CONTEXT_CHUNKS", 2):
        resp = await client.get(f"{BASE}/{exercise.id}")

    assert resp.status_code == 200
    assert resp.json()["chunks_total"] == 5
    assert resp.json()["chunks_used"] == 2


async def test_get_exercise(client, db_session):
    draft = await seed_draft(db_session, client, num_questions = 2)
    got = await client.get(f"{BASE}/{draft['id']}")
    assert got.status_code == 200
    assert len(got.json()["questions"]) == 2
    assert got.json()["chunks_total"] == 3


async def test_update_question(client, db_session):
    draft = await seed_draft(db_session, client, num_questions = 1)
    question_id = draft["questions"][0]["id"]
    patched = await client.patch(
        f"{BASE}/questions/{question_id}", json = {"question_text": "Edited?"}
    )
    assert patched.status_code == 200
    assert patched.json()["question_text"] == "Edited?"


async def test_update_option_repoints_correct(client, db_session):
    draft = await seed_draft(db_session, client, num_questions = 1)
    question = draft["questions"][0]
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
    from app.modules.exams.models import QuestionOption

    draft = await seed_draft(db_session, client, num_questions = 1)
    question = draft["questions"][0]
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
