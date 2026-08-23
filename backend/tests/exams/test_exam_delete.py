import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.dependencies import require_admin
from app.main import app
from app.modules.classes.models import Class
from app.modules.exams.models import Exercise, Question, QuestionOption
from app.modules.submissions.models import Submission
from tests.conftest import auth_header, seed_auth_user

BASE = "/api/v1/exams"


def _use_stub_admin():
    app.dependency_overrides[require_admin] = lambda: type("U", (), {"id": None})()


async def _seed_class(db):
    c = Class(name = f"Class {uuid.uuid4()}")
    db.add(c)
    await db.flush()
    return c


async def _seed_exercise(db, class_id):
    exercise = Exercise(
        title = "Del",
        class_id = class_id,
        start_time = datetime.now(timezone.utc),
        end_time = datetime.now(timezone.utc) + timedelta(hours = 1),
        duration_minutes = 60,
        pass_score = 0,
        total_points = 2,
        is_active = False,
    )
    for order_index in range(2):
        q = Question(question_text = f"Q{order_index}?", points = 1, order_index = order_index)
        q.options.append(QuestionOption(option_label = "A", option_text = "a", is_correct = True))
        q.options.append(QuestionOption(option_label = "B", option_text = "b", is_correct = False))
        exercise.questions.append(q)
    db.add(exercise)
    await db.flush()
    return exercise


async def _counts(db):
    return (
        await db.scalar(select(func.count()).select_from(Exercise)),
        await db.scalar(select(func.count()).select_from(Question)),
        await db.scalar(select(func.count()).select_from(QuestionOption)),
    )


async def test_delete_one_cascades(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    exercise = await _seed_exercise(db_session, cls.id)

    resp = await client.delete(f"{BASE}/{exercise.id}")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 1}

    # Exercise and its questions + options are all gone (cascade).
    assert await _counts(db_session) == (0, 0, 0)


async def test_delete_missing_returns_404(client, db_session):
    _use_stub_admin()
    resp = await client.delete(f"{BASE}/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_delete_all_without_confirm_rejected(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    await _seed_exercise(db_session, cls.id)

    resp = await client.delete(BASE)
    assert resp.status_code == 400
    # Nothing deleted.
    exercises, _, _ = await _counts(db_session)
    assert exercises == 1


async def test_delete_all_with_confirm(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    await _seed_exercise(db_session, cls.id)
    await _seed_exercise(db_session, cls.id)

    resp = await client.delete(f"{BASE}?confirm=true")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 2}
    assert await _counts(db_session) == (0, 0, 0)


async def test_delete_all_when_empty_is_zero(client, db_session):
    _use_stub_admin()
    resp = await client.delete(f"{BASE}?confirm=true")
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 0}


async def _seed_submission(db, exercise_id):
    user = await seed_auth_user(db, role = "learner")
    submission = Submission(user_id = user.id, exercise_id = exercise_id)
    db.add(submission)
    await db.flush()
    return submission


async def test_delete_one_with_submissions_blocked(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    exercise = await _seed_exercise(db_session, cls.id)
    await _seed_submission(db_session, exercise.id)

    resp = await client.delete(f"{BASE}/{exercise.id}")

    # 409 with a readable detail, not the raw 500 the RESTRICT FK produced before.
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot delete an exercise that has submissions."
    exercises, _, _ = await _counts(db_session)
    assert exercises == 1


async def test_delete_all_with_submissions_blocked(client, db_session):
    _use_stub_admin()
    cls = await _seed_class(db_session)
    exercise = await _seed_exercise(db_session, cls.id)
    await _seed_exercise(db_session, cls.id)
    await _seed_submission(db_session, exercise.id)

    resp = await client.delete(f"{BASE}?confirm=true")

    # Any submission at all blocks the bulk delete — it would otherwise abort
    # partway through as a 500.
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot delete exercises that have submissions."
    exercises, _, _ = await _counts(db_session)
    assert exercises == 2


async def test_delete_one_requires_token(auth_client, db_session):
    cls = await _seed_class(db_session)
    exercise = await _seed_exercise(db_session, cls.id)
    resp = await auth_client.delete(f"{BASE}/{exercise.id}")
    assert resp.status_code == 401
    assert await db_session.get(Exercise, exercise.id) is not None


async def test_delete_one_forbidden_for_learner(auth_client, db_session):
    cls = await _seed_class(db_session)
    exercise = await _seed_exercise(db_session, cls.id)
    learner = await seed_auth_user(db_session, role = "learner")
    resp = await auth_client.delete(
        f"{BASE}/{exercise.id}", headers = auth_header(learner)
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "Admin access required"}
    assert await db_session.get(Exercise, exercise.id) is not None


async def test_delete_all_requires_token(auth_client, db_session):
    cls = await _seed_class(db_session)
    await _seed_exercise(db_session, cls.id)
    resp = await auth_client.delete(f"{BASE}?confirm=true")
    assert resp.status_code == 401
    exercises, _, _ = await _counts(db_session)
    assert exercises == 1


async def test_delete_all_forbidden_for_learner(auth_client, db_session):
    cls = await _seed_class(db_session)
    await _seed_exercise(db_session, cls.id)
    learner = await seed_auth_user(db_session, role = "learner")
    resp = await auth_client.delete(
        f"{BASE}?confirm=true", headers = auth_header(learner)
    )
    assert resp.status_code == 403
    exercises, _, _ = await _counts(db_session)
    assert exercises == 1
