import itertools
import uuid
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.config.models import (
    Department,
    EmployeeLevel,
    JobPosition,
    SeniorityLevel,
)
from app.modules.documents.models import Document
from app.modules.quiz.models import (
    DailyQuiz,
    DailyQuizConfig,
    DailyQuizQuestion,
    DailyQuizQuestionOption,
    DailyQuizSubmission,
)

BASE = "/api/v1/quiz"

# seniority_levels.rank and employee_levels.rank are NOT NULL and unique.
_ranks = itertools.count(1)


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


async def _seed_user(db, role = "learner", **profile):
    user = User(
        id = uuid.uuid4(),
        email = f"{uuid.uuid4()}@kineti.com",
        password_hash = get_password_hash("secret123"),
        full_name = "Seed User",
        role = role,
        **profile,
    )
    db.add(user)
    await db.flush()
    return user


async def _seed_document(db):
    doc = Document(title = f"Doc {uuid.uuid4()}")
    db.add(doc)
    await db.flush()
    return doc


async def _seed_config(db, document, **targets):
    config = DailyQuizConfig(
        name = f"Config {uuid.uuid4()}",
        prompt = "Ask about safety.",
        source_document_id = document.id,
        start_date = date(2020, 1, 1),
        push_time = time(8, 0),
        timezone = "UTC",
        **targets,
    )
    db.add(config)
    await db.flush()
    return config


async def _seed_quiz(
    db,
    config,
    *,
    quiz_date = None,
    expires_in = timedelta(hours = 1),
    num_questions = 3,
):
    quiz = DailyQuiz(
        config_id = config.id,
        quiz_date = quiz_date or date.today(),
        expires_at = datetime.now(timezone.utc) + expires_in,
    )
    for i in range(num_questions):
        question = DailyQuizQuestion(
            question_text = f"Q{i}?",
            explanation = f"Because {i}.",
            points = 1,
            order_index = i,
        )
        # Option A is always the correct one.
        for label, correct in (("A", True), ("B", False)):
            question.options.append(DailyQuizQuestionOption(
                option_label = label,
                option_text = f"{label} text",
                is_correct = correct,
            ))
        quiz.questions.append(question)
    db.add(quiz)
    await db.flush()
    return quiz


async def _seed_submission(db, quiz, user, *, submitted_at, score = 0):
    submission = DailyQuizSubmission(
        daily_quiz_id = quiz.id,
        user_id = user.id,
        score = score,
        submitted_at = submitted_at,
    )
    db.add(submission)
    await db.flush()
    return submission


# A learner with no targeting attributes matched by a config that sets none.
async def _seed_open_quiz(db, **quiz_kwargs):
    document = await _seed_document(db)
    config = await _seed_config(db, document)
    return await _seed_quiz(db, config, **quiz_kwargs)


def _option(question, label):
    return next(o for o in question.options if o.option_label == label)


def _answer(question, label):
    return {
        "daily_quiz_question_id": str(question.id),
        "selected_option_id": str(_option(question, label).id),
    }


def _payload(quiz, answers):
    return {"daily_quiz_id": str(quiz.id), "answers": answers}


# --------------------------------------------------------------------------
# GET /today
# --------------------------------------------------------------------------

async def test_today_lists_open_quiz_for_matching_learner(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    resp = await auth_client.get(f"{BASE}/today", headers = _auth(user))

    assert resp.status_code == 200
    body = resp.json()
    assert [q["id"] for q in body] == [str(quiz.id)]
    assert body[0]["already_submitted"] is False
    assert len(body[0]["questions"]) == 3


async def test_today_excludes_expired_quiz(auth_client, db_session):
    user = await _seed_user(db_session)
    await _seed_open_quiz(db_session, expires_in = timedelta(hours = -1))

    resp = await auth_client.get(f"{BASE}/today", headers = _auth(user))

    assert resp.status_code == 200
    assert resp.json() == []


async def test_today_excludes_quiz_for_ineligible_learner(auth_client, db_session):
    department = Department(name = f"Dept {uuid.uuid4()}")
    db_session.add(department)
    await db_session.flush()

    # The learner has no department, so a department-targeted config misses them.
    user = await _seed_user(db_session)
    document = await _seed_document(db_session)
    config = await _seed_config(
        db_session, document, target_department_id = department.id
    )
    await _seed_quiz(db_session, config)

    resp = await auth_client.get(f"{BASE}/today", headers = _auth(user))

    assert resp.status_code == 200
    assert resp.json() == []


async def test_today_includes_quiz_when_all_four_targets_match(auth_client, db_session):
    department = Department(name = f"Dept {uuid.uuid4()}")
    seniority = SeniorityLevel(name = f"Sen {uuid.uuid4()}"[:50], rank = next(_ranks))
    job = JobPosition(name = f"Job {uuid.uuid4()}")
    level = EmployeeLevel(name = f"Lvl {uuid.uuid4()}"[:50], rank = next(_ranks))
    db_session.add_all([department, seniority, job, level])
    await db_session.flush()

    user = await _seed_user(
        db_session,
        department_id = department.id,
        seniority_id = seniority.id,
        job_position_id = job.id,
        employee_level_id = level.id,
    )
    document = await _seed_document(db_session)
    config = await _seed_config(
        db_session,
        document,
        target_department_id = department.id,
        target_seniority_id = seniority.id,
        target_job_position_id = job.id,
        target_employee_level_id = level.id,
    )
    quiz = await _seed_quiz(db_session, config)

    resp = await auth_client.get(f"{BASE}/today", headers = _auth(user))

    assert resp.status_code == 200
    assert [q["id"] for q in resp.json()] == [str(quiz.id)]


async def test_today_marks_already_submitted_after_submission(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    submit = await auth_client.post(
        f"{BASE}/submissions",
        json = _payload(quiz, [_answer(quiz.questions[0], "A")]),
        headers = _auth(user),
    )
    assert submit.status_code == 201

    resp = await auth_client.get(f"{BASE}/today", headers = _auth(user))

    assert resp.status_code == 200
    body = resp.json()
    # Still open, so it stays listed — only the flag changes.
    assert [q["id"] for q in body] == [str(quiz.id)]
    assert body[0]["already_submitted"] is True


async def test_today_hides_answer_key(auth_client, db_session):
    user = await _seed_user(db_session)
    await _seed_open_quiz(db_session)

    resp = await auth_client.get(f"{BASE}/today", headers = _auth(user))

    assert resp.status_code == 200
    for question in resp.json()[0]["questions"]:
        assert "explanation" not in question
        for option in question["options"]:
            assert "is_correct" not in option


async def test_today_questions_and_options_are_ordered(auth_client, db_session):
    user = await _seed_user(db_session)
    document = await _seed_document(db_session)
    config = await _seed_config(db_session, document)

    # Seeded back to front so a correct response cannot just be insertion order.
    quiz = DailyQuiz(
        config_id = config.id,
        quiz_date = date.today(),
        expires_at = datetime.now(timezone.utc) + timedelta(hours = 1),
    )
    for i in (2, 1, 0):
        question = DailyQuizQuestion(
            question_text = f"Q{i}?", points = 1, order_index = i
        )
        for label in ("B", "A"):
            question.options.append(DailyQuizQuestionOption(
                option_label = label,
                option_text = f"{label} text",
                is_correct = label == "A",
            ))
        quiz.questions.append(question)
    db_session.add(quiz)
    await db_session.flush()

    resp = await auth_client.get(f"{BASE}/today", headers = _auth(user))

    assert resp.status_code == 200
    questions = resp.json()[0]["questions"]
    assert [q["order_index"] for q in questions] == [0, 1, 2]
    for question in questions:
        assert [o["option_label"] for o in question["options"]] == ["A", "B"]


async def test_today_admin_sees_empty_list(auth_client, db_session):
    # Audience is defined over learners, so an admin matches nothing. This is a
    # role mismatch rather than a permission error, hence 200 with no rows.
    admin = await _seed_user(db_session, role = "admin")
    await _seed_open_quiz(db_session)

    resp = await auth_client.get(f"{BASE}/today", headers = _auth(admin))

    assert resp.status_code == 200
    assert resp.json() == []


async def test_today_requires_authentication(auth_client):
    resp = await auth_client.get(f"{BASE}/today")
    assert resp.status_code == 401


# --------------------------------------------------------------------------
# POST /submissions
# --------------------------------------------------------------------------

async def test_submit_all_correct_computes_score(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    answers = [_answer(q, "A") for q in quiz.questions]
    resp = await auth_client.post(
        f"{BASE}/submissions", json = _payload(quiz, answers), headers = _auth(user)
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["score"] == 3
    assert body["is_late"] is False
    assert body["quiz_date"] == quiz.quiz_date.isoformat()
    assert all(a["is_correct"] is True for a in body["answers"])


async def test_submit_partial_correct_computes_score(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    answers = [
        _answer(quiz.questions[0], "A"),
        _answer(quiz.questions[1], "B"),
        _answer(quiz.questions[2], "B"),
    ]
    resp = await auth_client.post(
        f"{BASE}/submissions", json = _payload(quiz, answers), headers = _auth(user)
    )

    assert resp.status_code == 201
    assert resp.json()["score"] == 1


async def test_skipped_questions_are_stored(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    resp = await auth_client.post(
        f"{BASE}/submissions",
        json = _payload(quiz, [_answer(quiz.questions[0], "A")]),
        headers = _auth(user),
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["score"] == 1
    # Every question is recorded, answered or not.
    assert len(body["answers"]) == 3
    skipped = [a for a in body["answers"] if a["selected_option_id"] is None]
    assert len(skipped) == 2
    assert all(a["is_correct"] is None and a["points_earned"] == 0 for a in skipped)


async def test_submit_after_expiry_is_accepted_and_flagged_late(
    auth_client, db_session
):
    # A daily quiz has no grading deadline, so an expired one is still graded
    # normally and only marked late.
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session, expires_in = timedelta(hours = -1))

    answers = [_answer(q, "A") for q in quiz.questions]
    resp = await auth_client.post(
        f"{BASE}/submissions", json = _payload(quiz, answers), headers = _auth(user)
    )

    assert resp.status_code == 201
    assert resp.json()["is_late"] is True
    assert resp.json()["score"] == 3


async def test_duplicate_submission_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)
    payload = _payload(quiz, [_answer(quiz.questions[0], "A")])

    first = await auth_client.post(
        f"{BASE}/submissions", json = payload, headers = _auth(user)
    )
    second = await auth_client.post(
        f"{BASE}/submissions", json = payload, headers = _auth(user)
    )

    assert first.status_code == 201
    assert second.status_code == 400
    assert second.json()["detail"] == "You have already submitted this daily quiz."


async def test_duplicate_submission_caught_by_constraint_when_precheck_misses(
    auth_client, db_session
):
    # Two submissions racing both read "nothing submitted yet" before either
    # writes. Stubbing the pre-check reproduces that window deterministically:
    # the unique constraint on (daily_quiz_id, user_id) has to reject the loser
    # rather than letting the insert through or surfacing a 500.
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)
    payload = _payload(quiz, [_answer(quiz.questions[0], "A")])

    first = await auth_client.post(
        f"{BASE}/submissions", json = payload, headers = _auth(user)
    )
    assert first.status_code == 201

    # scalar() is only used by submit() for the duplicate pre-check.
    with patch.object(db_session, "scalar", AsyncMock(return_value = None)):
        second = await auth_client.post(
            f"{BASE}/submissions", json = payload, headers = _auth(user)
        )

    assert second.status_code == 400
    assert second.json()["detail"] == "You have already submitted this daily quiz."


async def test_ineligible_learner_rejected(auth_client, db_session):
    # Mirrors a learner who changed department after the quiz was generated:
    # audience is recomputed at submit time, not snapshotted.
    department = Department(name = f"Dept {uuid.uuid4()}")
    db_session.add(department)
    await db_session.flush()

    user = await _seed_user(db_session)
    document = await _seed_document(db_session)
    config = await _seed_config(
        db_session, document, target_department_id = department.id
    )
    quiz = await _seed_quiz(db_session, config)

    resp = await auth_client.post(
        f"{BASE}/submissions",
        json = _payload(quiz, [_answer(quiz.questions[0], "A")]),
        headers = _auth(user),
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "This daily quiz is not available to you."


async def test_admin_rejected(auth_client, db_session):
    admin = await _seed_user(db_session, role = "admin")
    quiz = await _seed_open_quiz(db_session)

    resp = await auth_client.post(
        f"{BASE}/submissions",
        json = _payload(quiz, [_answer(quiz.questions[0], "A")]),
        headers = _auth(admin),
    )

    assert resp.status_code == 403


async def test_submit_quiz_not_found(auth_client, db_session):
    user = await _seed_user(db_session)

    resp = await auth_client.post(
        f"{BASE}/submissions",
        json = {"daily_quiz_id": str(uuid.uuid4()), "answers": []},
        headers = _auth(user),
    )

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Daily quiz not found."


async def test_answer_references_question_not_in_quiz(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)
    other = await _seed_open_quiz(db_session)

    resp = await auth_client.post(
        f"{BASE}/submissions",
        json = _payload(quiz, [_answer(other.questions[0], "A")]),
        headers = _auth(user),
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Answer references a question not in this quiz."


async def test_duplicate_answer_for_same_question_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    answers = [_answer(quiz.questions[0], "A"), _answer(quiz.questions[0], "B")]
    resp = await auth_client.post(
        f"{BASE}/submissions", json = _payload(quiz, answers), headers = _auth(user)
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Duplicate answer for a question."


async def test_option_from_another_question_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    answers = [{
        "daily_quiz_question_id": str(quiz.questions[0].id),
        "selected_option_id": str(_option(quiz.questions[1], "A").id),
    }]
    resp = await auth_client.post(
        f"{BASE}/submissions", json = _payload(quiz, answers), headers = _auth(user)
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Selected option does not belong to the question."


async def test_submit_requires_authentication(auth_client, db_session):
    quiz = await _seed_open_quiz(db_session)

    resp = await auth_client.post(
        f"{BASE}/submissions",
        json = _payload(quiz, [_answer(quiz.questions[0], "A")]),
    )

    assert resp.status_code == 401


# --------------------------------------------------------------------------
# GET /submissions/me
# --------------------------------------------------------------------------

async def test_history_returns_own_submissions_ordered_desc(auth_client, db_session):
    user = await _seed_user(db_session)
    document = await _seed_document(db_session)
    config = await _seed_config(db_session, document)
    older_quiz = await _seed_quiz(db_session, config, quiz_date = date(2024, 5, 1))
    newer_quiz = await _seed_quiz(db_session, config, quiz_date = date(2024, 5, 2))

    # Seeded directly with fixed timestamps so the ordering assertion is exact.
    await _seed_submission(
        db_session, older_quiz, user,
        submitted_at = datetime(2024, 5, 1, 9, 0, tzinfo = timezone.utc), score = 1,
    )
    await _seed_submission(
        db_session, newer_quiz, user,
        submitted_at = datetime(2024, 5, 2, 9, 0, tzinfo = timezone.utc), score = 3,
    )

    resp = await auth_client.get(f"{BASE}/submissions/me", headers = _auth(user))

    assert resp.status_code == 200
    body = resp.json()
    assert [row["quiz_date"] for row in body] == ["2024-05-02", "2024-05-01"]
    assert [row["score"] for row in body] == [3, 1]


async def test_history_excludes_other_learners(auth_client, db_session):
    user = await _seed_user(db_session)
    other = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    await _seed_submission(
        db_session, quiz, other,
        submitted_at = datetime(2024, 5, 1, 9, 0, tzinfo = timezone.utc),
    )

    resp = await auth_client.get(f"{BASE}/submissions/me", headers = _auth(user))

    assert resp.status_code == 200
    assert resp.json() == []


async def test_history_excludes_answers(auth_client, db_session):
    user = await _seed_user(db_session)
    quiz = await _seed_open_quiz(db_session)

    submit = await auth_client.post(
        f"{BASE}/submissions",
        json = _payload(quiz, [_answer(quiz.questions[0], "A")]),
        headers = _auth(user),
    )
    assert submit.status_code == 201

    resp = await auth_client.get(f"{BASE}/submissions/me", headers = _auth(user))

    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert "answers" not in resp.json()[0]


async def test_history_empty_for_new_learner(auth_client, db_session):
    user = await _seed_user(db_session)

    resp = await auth_client.get(f"{BASE}/submissions/me", headers = _auth(user))

    assert resp.status_code == 200
    assert resp.json() == []


async def test_history_requires_authentication(auth_client):
    resp = await auth_client.get(f"{BASE}/submissions/me")
    assert resp.status_code == 401
