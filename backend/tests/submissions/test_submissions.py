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

BASE = "/api/v1/submissions"


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


async def _seed_class_with_member(db, user):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    db.add(ClassMember(class_id = cls.id, user_id = user.id))
    await db.flush()
    return cls


async def _seed_exercise(
    db,
    class_id,
    *,
    is_active = True,
    pass_score = 2,
    starts_in = timedelta(hours = -1),
    ends_in = timedelta(hours = 1),
    num_questions = 3,
):
    now = datetime.now(timezone.utc)
    exercise = Exercise(
        class_id = class_id,
        title = "Exam",
        start_time = now + starts_in,
        end_time = now + ends_in,
        duration_minutes = 60,
        pass_score = pass_score,
        total_points = num_questions,
        is_active = is_active,
    )
    db.add(exercise)
    await db.flush()

    questions = []
    for i in range(num_questions):
        q = Question(
            exercise_id = exercise.id,
            question_text = f"Q{i}?",
            points = 1,
            order_index = i,
        )
        db.add(q)
        await db.flush()
        # Option A is always the correct one.
        for label, correct in (("A", True), ("B", False)):
            db.add(QuestionOption(
                question_id = q.id,
                option_label = label,
                option_text = f"{label} text",
                is_correct = correct,
            ))
        await db.flush()
        questions.append(q)
    return exercise, questions


async def _options(db, question):
    from sqlalchemy import select
    result = await db.execute(
        select(QuestionOption).where(QuestionOption.question_id == question.id)
    )
    return {o.option_label: o for o in result.scalars().all()}


async def _answer(db, question, label):
    opts = await _options(db, question)
    return {"question_id": str(question.id), "selected_option_id": str(opts[label].id)}


async def test_submit_all_correct_passes(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id)

    answers = [await _answer(db_session, q, "A") for q in questions]
    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": answers},
        headers = _auth(user),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["score"] == 3
    assert body["is_passed"] is True
    assert body["is_late"] is False
    assert body["attempt_number"] == 1
    assert all(a["is_correct"] is True for a in body["answers"])


async def test_submit_partial_credit_fails_below_pass_score(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id, pass_score = 3)

    # One correct, two wrong -> score 1, below pass_score 3.
    answers = [
        await _answer(db_session, questions[0], "A"),
        await _answer(db_session, questions[1], "B"),
        await _answer(db_session, questions[2], "B"),
    ]
    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": answers},
        headers = _auth(user),
    )
    assert resp.status_code == 201
    assert resp.json()["score"] == 1
    assert resp.json()["is_passed"] is False


async def test_skipped_questions_are_stored(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id)

    # Only answer the first question; the other two are omitted entirely.
    answers = [await _answer(db_session, questions[0], "A")]
    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": answers},
        headers = _auth(user),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert len(body["answers"]) == 3
    skipped = [a for a in body["answers"] if a["selected_option_id"] is None]
    assert len(skipped) == 2
    assert all(a["is_correct"] is None and a["points_earned"] == 0 for a in skipped)


async def test_submit_after_end_time_is_flagged_late(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(
        db_session, cls.id, starts_in = timedelta(hours = -3), ends_in = timedelta(hours = -1)
    )

    answers = [await _answer(db_session, q, "A") for q in questions]
    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": answers},
        headers = _auth(user),
    )
    # Accepted and still graded, just flagged.
    assert resp.status_code == 201
    assert resp.json()["is_late"] is True
    assert resp.json()["score"] == 3


async def test_submit_before_start_time_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, _ = await _seed_exercise(
        db_session, cls.id, starts_in = timedelta(hours = 1), ends_in = timedelta(hours = 2)
    )

    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": []},
        headers = _auth(user),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Exercise has not started yet."


async def test_non_member_rejected(auth_client, db_session):
    outsider = await _seed_user(db_session)
    member = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, member)
    exercise, _ = await _seed_exercise(db_session, cls.id)

    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": []},
        headers = _auth(outsider),
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "You are not a member of this class."


async def test_non_member_rejected_before_state_is_revealed(auth_client, db_session):
    # Exercise is unfinalized AND the user is not a member: membership must be
    # checked first, so the response must not leak the not-finalized state.
    outsider = await _seed_user(db_session)
    member = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, member)
    exercise, _ = await _seed_exercise(db_session, cls.id, is_active = False)

    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": []},
        headers = _auth(outsider),
    )
    assert resp.status_code == 403


async def test_unfinalized_exercise_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, _ = await _seed_exercise(db_session, cls.id, is_active = False)

    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": []},
        headers = _auth(user),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Exercise is not finalized."


async def test_option_from_another_question_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id)

    other_opts = await _options(db_session, questions[1])
    resp = await auth_client.post(
        BASE,
        json = {
            "exercise_id": str(exercise.id),
            "answers": [{
                "question_id": str(questions[0].id),
                "selected_option_id": str(other_opts["A"].id),
            }],
        },
        headers = _auth(user),
    )
    assert resp.status_code == 400


async def test_retry_increments_attempt_number_and_keeps_history(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id)

    wrong = [await _answer(db_session, q, "B") for q in questions]
    first = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": wrong},
        headers = _auth(user),
    )
    assert first.json()["attempt_number"] == 1
    assert first.json()["score"] == 0

    right = [await _answer(db_session, q, "A") for q in questions]
    second = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": right},
        headers = _auth(user),
    )
    assert second.status_code == 201
    assert second.json()["attempt_number"] == 2
    assert second.json()["score"] == 3

    # Both attempts persist — the first is not overwritten.
    mine = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert len(mine.json()) == 2


async def test_get_my_submissions_only_returns_own(auth_client, db_session):
    user = await _seed_user(db_session)
    other = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    db_session.add(ClassMember(class_id = cls.id, user_id = other.id))
    await db_session.flush()
    exercise, questions = await _seed_exercise(db_session, cls.id)

    answers = [await _answer(db_session, q, "A") for q in questions]
    body = {"exercise_id": str(exercise.id), "answers": answers}
    await auth_client.post(BASE, json = body, headers = _auth(user))
    await auth_client.post(BASE, json = body, headers = _auth(other))

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["user_id"] == str(user.id)


async def test_learner_cannot_read_another_learners_submission(auth_client, db_session):
    user = await _seed_user(db_session)
    other = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id)

    answers = [await _answer(db_session, q, "A") for q in questions]
    created = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": answers},
        headers = _auth(user),
    )
    submission_id = created.json()["id"]

    resp = await auth_client.get(f"{BASE}/{submission_id}", headers = _auth(other))
    assert resp.status_code == 403


async def test_admin_can_read_and_list_submissions(auth_client, db_session):
    admin = await _seed_user(db_session, role = "admin")
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id)

    answers = [await _answer(db_session, q, "A") for q in questions]
    created = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": answers},
        headers = _auth(user),
    )
    submission_id = created.json()["id"]

    detail = await auth_client.get(f"{BASE}/{submission_id}", headers = _auth(admin))
    assert detail.status_code == 200

    listed = await auth_client.get(
        BASE, params = {"class_id": str(cls.id)}, headers = _auth(admin)
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 1


async def test_learner_forbidden_on_admin_list(auth_client, db_session):
    user = await _seed_user(db_session)
    resp = await auth_client.get(BASE, headers = _auth(user))
    assert resp.status_code == 403


async def test_admin_edit_score_recomputes_is_passed(auth_client, db_session):
    admin = await _seed_user(db_session, role = "admin")
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id, pass_score = 2)

    wrong = [await _answer(db_session, q, "B") for q in questions]
    created = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": wrong},
        headers = _auth(user),
    )
    assert created.json()["is_passed"] is False
    submission_id = created.json()["id"]

    resp = await auth_client.patch(
        f"{BASE}/{submission_id}", json = {"score": 3}, headers = _auth(admin)
    )
    assert resp.status_code == 200
    assert resp.json()["score"] == 3
    assert resp.json()["is_passed"] is True


async def test_admin_edit_score_rejects_above_total_points(auth_client, db_session):
    admin = await _seed_user(db_session, role = "admin")
    user = await _seed_user(db_session)
    cls = await _seed_class_with_member(db_session, user)
    exercise, questions = await _seed_exercise(db_session, cls.id)

    answers = [await _answer(db_session, q, "A") for q in questions]
    created = await auth_client.post(
        BASE,
        json = {"exercise_id": str(exercise.id), "answers": answers},
        headers = _auth(user),
    )

    resp = await auth_client.patch(
        f"{BASE}/{created.json()['id']}",
        json = {"score": 99},
        headers = _auth(admin),
    )
    assert resp.status_code == 400


async def test_learner_forbidden_on_score_edit(auth_client, db_session):
    user = await _seed_user(db_session)
    resp = await auth_client.patch(
        f"{BASE}/{uuid.uuid4()}", json = {"score": 1}, headers = _auth(user)
    )
    assert resp.status_code == 403


async def test_submit_exercise_not_found(auth_client, db_session):
    user = await _seed_user(db_session)
    resp = await auth_client.post(
        BASE,
        json = {"exercise_id": str(uuid.uuid4()), "answers": []},
        headers = _auth(user),
    )
    assert resp.status_code == 404


async def test_submit_requires_authentication(auth_client, db_session):
    resp = await auth_client.post(
        BASE, json = {"exercise_id": str(uuid.uuid4()), "answers": []}
    )
    assert resp.status_code == 401
