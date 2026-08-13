import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.core.dependencies import require_admin
from app.main import app
from app.modules.classes.models import Class
from app.modules.exams.models import Exercise, Question, QuestionOption

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
        end_time = datetime.now(timezone.utc),
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
