import uuid
from datetime import datetime, timedelta, timezone

from tests.conftest import auth_header, seed_auth_user
from tests.exams.helpers import BASE, seed_draft


# Generation now runs in the worker and POST /exams/generate returns a job, not an
# exercise. These tests only ever needed a draft to edit, so seed one directly.
async def _make_draft(client, db):
    return await seed_draft(db, client, num_questions = 3, title = "Original title")


async def _finalize(client, exercise_id):
    return await client.put(f"{BASE}/{exercise_id}/finalize", json = {
        "start_time": "2026-01-01T09:00:00Z",
        "end_time": "2026-01-02T09:00:00Z",
        "duration_minutes": 30,
        "pass_score": 1,
    })


# unpublish refuses once an exercise has opened (test_exam_unpublish.py), so the
# two "editable again after unpublish" tests below need a start_time still in
# the future — the fixed 2026-01-01 _finalize uses is already past by the time
# this suite runs.
async def _finalize_not_yet_open(client, exercise_id):
    start = (datetime.now(timezone.utc) + timedelta(days = 1)).isoformat()
    end = (datetime.now(timezone.utc) + timedelta(days = 2)).isoformat()
    return await client.put(f"{BASE}/{exercise_id}/finalize", json = {
        "start_time": start,
        "end_time": end,
        "duration_minutes": 30,
        "pass_score": 1,
    })


# --- PATCH /exams/{id} ---------------------------------------------------


async def test_rename_draft(client, db_session):
    draft = await _make_draft(client, db_session)
    exercise_id = draft["id"]

    patched = await client.patch(f"{BASE}/{exercise_id}", json = {"title": "Renamed"})
    assert patched.status_code == 200
    assert patched.json()["title"] == "Renamed"

    # Persisted, not just echoed back.
    fetched = await client.get(f"{BASE}/{exercise_id}")
    assert fetched.json()["title"] == "Renamed"


async def test_rename_leaves_the_questions_alone(client, db_session):
    body = await _make_draft(client, db_session)
    exercise_id = body["id"]

    patched = await client.patch(f"{BASE}/{exercise_id}", json = {"title": "Renamed"})
    assert len(patched.json()["questions"]) == len(body["questions"])


async def test_rename_rejected_once_finalized(client, db_session):
    draft = await _make_draft(client, db_session)
    exercise_id = draft["id"]
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
    draft = await _make_draft(client, db_session)
    exercise_id = draft["id"]

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


# --- question/option edits are guarded by exercise state -----------------
# Same three-state pattern as the rename tests above: writable on a draft,
# refused once finalized, writable again after unpublish.


async def test_question_edit_still_works_on_a_draft(client, db_session):
    draft = await _make_draft(client, db_session)
    question_id = draft["questions"][0]["id"]

    patched = await client.patch(
        f"{BASE}/questions/{question_id}", json = {"points": 4}
    )
    assert patched.status_code == 200
    assert patched.json()["points"] == 4


async def test_option_edit_still_works_on_a_draft(client, db_session):
    draft = await _make_draft(client, db_session)
    question = draft["questions"][0]
    option_id = question["options"][0]["id"]

    patched = await client.patch(
        f"{BASE}/questions/{question['id']}/options/{option_id}",
        json = {"option_text": "Edited option"},
    )
    assert patched.status_code == 200
    edited = next(o for o in patched.json()["options"] if o["id"] == option_id)
    assert edited["option_text"] == "Edited option"


async def test_question_edit_rejected_once_finalized(client, db_session):
    body = await _make_draft(client, db_session)
    exercise_id = body["id"]
    question = body["questions"][0]
    assert (await _finalize(client, exercise_id)).status_code == 200

    patched = await client.patch(
        f"{BASE}/questions/{question['id']}", json = {"points": 4}
    )
    assert patched.status_code == 409
    assert patched.json()["detail"] == "Cannot edit a finalized exercise"

    # And nothing changed.
    fetched = await client.get(f"{BASE}/{exercise_id}")
    fetched_question = next(
        q for q in fetched.json()["questions"] if q["id"] == question["id"]
    )
    assert fetched_question["points"] == question["points"]


async def test_option_edit_rejected_once_finalized(client, db_session):
    body = await _make_draft(client, db_session)
    exercise_id = body["id"]
    question = body["questions"][0]
    option = question["options"][0]
    assert (await _finalize(client, exercise_id)).status_code == 200

    patched = await client.patch(
        f"{BASE}/questions/{question['id']}/options/{option['id']}",
        json = {"option_text": "Too late"},
    )
    assert patched.status_code == 409
    assert patched.json()["detail"] == "Cannot edit a finalized exercise"

    # And nothing changed.
    fetched = await client.get(f"{BASE}/{exercise_id}")
    fetched_question = next(
        q for q in fetched.json()["questions"] if q["id"] == question["id"]
    )
    fetched_option = next(
        o for o in fetched_question["options"] if o["id"] == option["id"]
    )
    assert fetched_option["option_text"] == option["option_text"]


async def test_question_edit_works_again_after_unpublish(client, db_session):
    body = await _make_draft(client, db_session)
    exercise_id = body["id"]
    question_id = body["questions"][0]["id"]
    assert (await _finalize_not_yet_open(client, exercise_id)).status_code == 200

    unpub = await client.patch(f"{BASE}/{exercise_id}/unpublish")
    assert unpub.status_code == 200

    patched = await client.patch(
        f"{BASE}/questions/{question_id}", json = {"points": 4}
    )
    assert patched.status_code == 200
    assert patched.json()["points"] == 4


async def test_option_edit_works_again_after_unpublish(client, db_session):
    body = await _make_draft(client, db_session)
    exercise_id = body["id"]
    question = body["questions"][0]
    option_id = question["options"][0]["id"]
    assert (await _finalize_not_yet_open(client, exercise_id)).status_code == 200

    unpub = await client.patch(f"{BASE}/{exercise_id}/unpublish")
    assert unpub.status_code == 200

    patched = await client.patch(
        f"{BASE}/questions/{question['id']}/options/{option_id}",
        json = {"option_text": "Edited after unpublish"},
    )
    assert patched.status_code == 200
    edited = next(o for o in patched.json()["options"] if o["id"] == option_id)
    assert edited["option_text"] == "Edited after unpublish"
