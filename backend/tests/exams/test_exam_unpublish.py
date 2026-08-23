import uuid
from datetime import datetime, timedelta, timezone

from app.modules.classes.models import Class
from app.modules.exams.models import Exercise
from app.modules.submissions.models import Submission
from tests.conftest import auth_header, seed_auth_user
from tests.exams.test_exam_finalize import _finalize_body, _generate_draft

BASE = "/api/v1/exams"


def _future_iso():
    return (datetime.now(timezone.utc) + timedelta(days = 1)).isoformat()


def _past_iso():
    return (datetime.now(timezone.utc) - timedelta(days = 1)).isoformat()


async def _finalize(client, exercise_id, *, start, end):
    resp = await client.put(
        f"{BASE}/{exercise_id}/finalize",
        json = _finalize_body(start = start, end = end, pass_score = 0),
    )
    assert resp.status_code == 200
    return resp.json()


# Seeds a live exercise straight through the ORM, bypassing the client and the
# stub-admin override that _generate_draft/_finalize rely on -- used only by the
# auth tests, which need require_admin running for real.
async def _seed_live_exercise(db, *, start, end):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    exercise = Exercise(
        title = "Live exam",
        class_id = cls.id,
        start_time = start,
        end_time = end,
        duration_minutes = 60,
        pass_score = 0,
        total_points = 0,
        is_active = True,
    )
    db.add(exercise)
    await db.flush()
    return exercise


async def test_unpublish_before_it_opens_succeeds(client, db_session):
    draft = await _generate_draft(client, db_session)
    exercise_id = draft["id"]
    start = _future_iso()
    end = (datetime.now(timezone.utc) + timedelta(days = 2)).isoformat()
    finalized = await _finalize(client, exercise_id, start = start, end = end)

    resp = await client.patch(f"{BASE}/{exercise_id}/unpublish")

    assert resp.status_code == 200
    body = resp.json()
    assert body["is_active"] is False
    # Schedule is left exactly as finalize set it, so a re-finalize is a
    # re-confirm rather than starting from scratch.
    assert body["start_time"] == finalized["start_time"]
    assert body["end_time"] == finalized["end_time"]
    assert body["duration_minutes"] == finalized["duration_minutes"]
    assert body["pass_score"] == finalized["pass_score"]

    row = await db_session.get(Exercise, uuid.UUID(exercise_id))
    await db_session.refresh(row)
    assert row.is_active is False


async def test_questions_are_editable_again_after_unpublish(client, db_session):
    draft = await _generate_draft(client, db_session)
    exercise_id = draft["id"]
    await _finalize(client, exercise_id, start = _future_iso(), end = _future_iso())

    unpub = await client.patch(f"{BASE}/{exercise_id}/unpublish")
    assert unpub.status_code == 200

    question_id = draft["questions"][0]["id"]
    patched = await client.patch(
        f"{BASE}/questions/{question_id}", json = {"points": 9}
    )
    assert patched.status_code == 200
    assert patched.json()["points"] == 9


async def test_can_re_finalize_after_unpublish(client, db_session):
    draft = await _generate_draft(client, db_session)
    exercise_id = draft["id"]
    await _finalize(client, exercise_id, start = _future_iso(), end = _future_iso())
    assert (await client.patch(f"{BASE}/{exercise_id}/unpublish")).status_code == 200

    resp = await _finalize(client, exercise_id, start = _future_iso(), end = _future_iso())
    assert resp["is_active"] is True


async def test_unpublish_blocked_by_submission(client, db_session):
    draft = await _generate_draft(client, db_session)
    exercise_id = draft["id"]
    # Started in the past so a submission is actually allowed to exist.
    await _finalize(
        client,
        exercise_id,
        start = _past_iso(),
        end = (datetime.now(timezone.utc) + timedelta(days = 1)).isoformat(),
    )
    learner = await seed_auth_user(db_session, role = "learner")
    db_session.add(Submission(user_id = learner.id, exercise_id = uuid.UUID(exercise_id)))
    await db_session.flush()

    resp = await client.patch(f"{BASE}/{exercise_id}/unpublish")

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot unpublish an exercise that has submissions."
    row = await db_session.get(Exercise, uuid.UUID(exercise_id))
    await db_session.refresh(row)
    assert row.is_active is True


async def test_unpublish_blocked_once_it_has_opened(client, db_session):
    draft = await _generate_draft(client, db_session)
    exercise_id = draft["id"]
    # No submission at all, but the window has already opened -- a learner
    # could be mid-attempt with no row yet to prove it.
    await _finalize(
        client,
        exercise_id,
        start = _past_iso(),
        end = (datetime.now(timezone.utc) + timedelta(days = 1)).isoformat(),
    )

    resp = await client.patch(f"{BASE}/{exercise_id}/unpublish")

    assert resp.status_code == 409
    assert resp.json()["detail"] == (
        "Cannot unpublish an exercise that has already opened to learners."
    )
    row = await db_session.get(Exercise, uuid.UUID(exercise_id))
    await db_session.refresh(row)
    assert row.is_active is True


async def test_unpublish_a_draft_rejected(client, db_session):
    draft = await _generate_draft(client, db_session)

    resp = await client.patch(f"{BASE}/{draft['id']}/unpublish")

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Exercise is already a draft"


async def test_unpublish_missing_exercise_404(client, db_session):
    resp = await client.patch(f"{BASE}/{uuid.uuid4()}/unpublish")
    assert resp.status_code == 404


async def test_unpublish_requires_token(auth_client, db_session):
    exercise = await _seed_live_exercise(
        db_session,
        start = datetime.now(timezone.utc) + timedelta(days = 1),
        end = datetime.now(timezone.utc) + timedelta(days = 2),
    )

    resp = await auth_client.patch(f"{BASE}/{exercise.id}/unpublish")

    assert resp.status_code == 401
    await db_session.refresh(exercise)
    assert exercise.is_active is True


async def test_unpublish_forbidden_for_learner(auth_client, db_session):
    exercise = await _seed_live_exercise(
        db_session,
        start = datetime.now(timezone.utc) + timedelta(days = 1),
        end = datetime.now(timezone.utc) + timedelta(days = 2),
    )
    learner = await seed_auth_user(db_session, role = "learner")

    resp = await auth_client.patch(
        f"{BASE}/{exercise.id}/unpublish", headers = auth_header(learner)
    )

    assert resp.status_code == 403
    assert resp.json() == {"detail": "Admin access required"}
    await db_session.refresh(exercise)
    assert exercise.is_active is True
