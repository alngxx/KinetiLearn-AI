import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.classes.models import Class, ClassMember
from app.modules.exams.models import Exercise, Question, QuestionOption

BASE = "/api/v1/exams"


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


async def _seed_user(db, role = "learner"):
    user = User(
        id = uuid.uuid4(),
        email = f"{uuid.uuid4()}@kineti.com",
        password_hash = get_password_hash("secret123"),
        full_name = "Seed User",
        role = role,
    )
    db.add(user)
    await db.flush()
    return user


async def _seed_class(db, *members):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    for user in members:
        db.add(ClassMember(class_id = cls.id, user_id = user.id))
    await db.flush()
    return cls


async def _seed_exercise(
    db,
    class_id,
    *,
    is_active = True,
    starts_in = timedelta(hours = -1),
    ends_in = timedelta(hours = 1),
    num_questions = 3,
):
    now = datetime.now(timezone.utc)
    exercise = Exercise(
        class_id = class_id,
        title = "Exam",
        description = "An exam.",
        start_time = now + starts_in,
        end_time = now + ends_in,
        duration_minutes = 45,
        pass_score = 2,
        total_points = num_questions,
        is_active = is_active,
    )
    db.add(exercise)
    await db.flush()

    # Inserted back-to-front so a correct response cannot rely on insertion order.
    for i in reversed(range(num_questions)):
        question = Question(
            exercise_id = exercise.id,
            question_text = f"Q{i}?",
            explanation = f"Because {i}.",
            points = 1,
            order_index = i,
        )
        db.add(question)
        await db.flush()
        for label, correct in (("B", False), ("A", True)):
            db.add(QuestionOption(
                question_id = question.id,
                option_label = label,
                option_text = f"{label} text",
                is_correct = correct,
            ))
        await db.flush()
    return exercise


# --------------------------------------------------------------------------
# The answer key must never reach a learner
# --------------------------------------------------------------------------

async def test_take_never_exposes_the_answer_key(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(db_session, cls.id)

    resp = await auth_client.get(f"{BASE}/{exercise.id}/take", headers = _auth(user))
    assert resp.status_code == 200

    # Checked against the raw body, not the parsed shape, so a nested leak at any
    # depth still fails the test.
    raw = resp.text
    assert "is_correct" not in raw
    assert "explanation" not in raw
    assert "Because" not in raw

    for question in resp.json()["questions"]:
        assert set(question) == {
            "id", "question_text", "points", "order_index", "options",
        }
        for option in question["options"]:
            assert set(option) == {"id", "option_label", "option_text"}


async def test_take_returns_the_schedule_and_sorted_questions(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(db_session, cls.id, num_questions = 4)

    resp = await auth_client.get(f"{BASE}/{exercise.id}/take", headers = _auth(user))
    assert resp.status_code == 200
    body = resp.json()

    assert body["id"] == str(exercise.id)
    assert body["class_id"] == str(cls.id)
    assert body["title"] == "Exam"
    assert body["description"] == "An exam."
    assert body["duration_minutes"] == 45
    assert body["pass_score"] == 2
    assert body["total_points"] == 4
    assert body["start_time"] is not None
    assert body["end_time"] is not None

    # Seeded back-to-front, so this only passes if the service sorts.
    assert [q["order_index"] for q in body["questions"]] == [0, 1, 2, 3]
    for question in body["questions"]:
        assert [o["option_label"] for o in question["options"]] == ["A", "B"]


# --------------------------------------------------------------------------
# Guards — same codes and messages as POST /submissions
# --------------------------------------------------------------------------

async def test_take_requires_authentication(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(db_session, cls.id)

    resp = await auth_client.get(f"{BASE}/{exercise.id}/take")
    assert resp.status_code == 401


async def test_take_rejects_a_non_member(auth_client, db_session):
    member = await _seed_user(db_session)
    outsider = await _seed_user(db_session)
    cls = await _seed_class(db_session, member)
    exercise = await _seed_exercise(db_session, cls.id)

    resp = await auth_client.get(
        f"{BASE}/{exercise.id}/take", headers = _auth(outsider)
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "You are not a member of this class."}


async def test_membership_is_checked_before_exercise_state(auth_client, db_session):
    member = await _seed_user(db_session)
    outsider = await _seed_user(db_session)
    cls = await _seed_class(db_session, member)
    # Both unfinalized and not started: a member would get 400 on either.
    exercise = await _seed_exercise(
        db_session,
        cls.id,
        is_active = False,
        starts_in = timedelta(hours = 1),
        ends_in = timedelta(hours = 2),
    )

    resp = await auth_client.get(
        f"{BASE}/{exercise.id}/take", headers = _auth(outsider)
    )
    # 403, not 400 — a non-member must not learn the exercise's state.
    assert resp.status_code == 403


async def test_take_rejects_an_unfinalized_exercise(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(db_session, cls.id, is_active = False)

    resp = await auth_client.get(f"{BASE}/{exercise.id}/take", headers = _auth(user))
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Exercise is not finalized."}


async def test_take_rejects_before_start_time(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(
        db_session,
        cls.id,
        starts_in = timedelta(hours = 1),
        ends_in = timedelta(hours = 2),
    )

    resp = await auth_client.get(f"{BASE}/{exercise.id}/take", headers = _auth(user))
    assert resp.status_code == 400
    assert resp.json() == {"detail": "Exercise has not started yet."}


# submit() accepts late answers and flags them is_late, so the read must stay open
# past end_time or that path becomes unreachable.
async def test_take_still_allowed_after_end_time(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(
        db_session,
        cls.id,
        starts_in = timedelta(hours = -3),
        ends_in = timedelta(hours = -1),
    )

    resp = await auth_client.get(f"{BASE}/{exercise.id}/take", headers = _auth(user))
    assert resp.status_code == 200


async def test_take_404s_for_an_unknown_exercise(auth_client, db_session):
    user = await _seed_user(db_session)

    resp = await auth_client.get(f"{BASE}/{uuid.uuid4()}/take", headers = _auth(user))
    assert resp.status_code == 404
    assert resp.json() == {"detail": "Exercise not found."}


# --------------------------------------------------------------------------
# The admin view keeps the answer key
# --------------------------------------------------------------------------

async def test_admin_view_still_carries_the_answer_key(client, db_session):
    user = await _seed_user(db_session, role = "admin")
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(db_session, cls.id)

    resp = await client.get(f"{BASE}/{exercise.id}")
    assert resp.status_code == 200
    body = resp.json()

    # Widened in this change so the admin UI can show what finalize set.
    assert body["duration_minutes"] == 45
    assert body["pass_score"] == 2
    assert body["description"] == "An exam."

    options = body["questions"][0]["options"]
    assert any(o["is_correct"] for o in options)
