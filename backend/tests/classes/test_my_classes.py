import uuid
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.classes.models import Class, ClassMember
from app.modules.config.models import Category, Skill
from app.modules.documents.models import Document, DocumentSkill, DocumentVersion
from app.modules.exams.models import (
    Exercise,
    ExerciseDocument,
    Question,
    QuestionOption,
)
from app.modules.submissions.models import Submission

BASE = "/api/v1/classes"


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


async def _seed_class(db, *members, is_active = True, name = None):
    cls = Class(name = name or f"Class {uuid.uuid4()}", is_active = is_active)
    db.add(cls)
    await db.flush()
    for user in members:
        db.add(ClassMember(class_id = cls.id, user_id = user.id))
    await db.flush()
    return cls


async def _seed_skill(db, name):
    category = Category(name = f"Cat {uuid.uuid4()}")
    db.add(category)
    await db.flush()
    skill = Skill(
        category_id = category.id,
        name = name,
        basic_max = 2,
        intermediate_max = 4,
    )
    db.add(skill)
    await db.flush()
    return skill


async def _seed_document(db, skills = ()):
    document = Document(title = f"Doc {uuid.uuid4()}")
    db.add(document)
    await db.flush()
    db.add(DocumentVersion(
        document_id = document.id,
        version_number = 1,
        file_url = "https://r2.example/doc.pdf",
        file_name = "doc.pdf",
        file_size_bytes = 1024,
        mime_type = "application/pdf",
        processing_status = "ready",
    ))
    document.active_version_number = 1
    for skill in skills:
        db.add(DocumentSkill(document_id = document.id, skill_id = skill.id))
    await db.flush()
    return document


async def _seed_exercise(
    db,
    class_id,
    *,
    is_active = True,
    num_questions = 2,
    documents = (),
):
    now = datetime.now(timezone.utc)
    exercise = Exercise(
        class_id = class_id,
        title = "Exam",
        start_time = now - timedelta(hours = 1),
        end_time = now + timedelta(hours = 1),
        duration_minutes = 60,
        pass_score = 1,
        total_points = num_questions,
        is_active = is_active,
    )
    db.add(exercise)
    await db.flush()

    for i in range(num_questions):
        question = Question(
            exercise_id = exercise.id,
            question_text = f"Q{i}?",
            points = 1,
            order_index = i,
        )
        db.add(question)
        await db.flush()
        for label, correct in (("A", True), ("B", False)):
            db.add(QuestionOption(
                question_id = question.id,
                option_label = label,
                option_text = f"{label} text",
                is_correct = correct,
            ))
    for document in documents:
        db.add(ExerciseDocument(
            exercise_id = exercise.id,
            document_id = document.id,
            version_number = 1,
        ))
    await db.flush()
    return exercise


async def _seed_submission(
    db, user, exercise, *, score = 2, is_passed = True, attempt_number = 1
):
    submission = Submission(
        user_id = user.id,
        exercise_id = exercise.id,
        attempt_number = attempt_number,
        submitted_at = datetime.now(timezone.utc),
        score = score,
        is_passed = is_passed,
        is_late = False,
    )
    db.add(submission)
    await db.flush()
    return submission


# --------------------------------------------------------------------------
# GET /classes/me
# --------------------------------------------------------------------------

async def test_my_classes_returns_only_enrolled_classes(auth_client, db_session):
    user = await _seed_user(db_session)
    other = await _seed_user(db_session)
    mine = await _seed_class(db_session, user)
    await _seed_class(db_session, other)

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == str(mine.id)
    assert body[0]["enrolled_at"] is not None


async def test_my_classes_never_exposes_created_by(auth_client, db_session):
    user = await _seed_user(db_session)
    await _seed_class(db_session, user)

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert resp.status_code == 200
    assert "created_by" not in resp.json()[0]


async def test_my_classes_excludes_deactivated_classes(auth_client, db_session):
    user = await _seed_user(db_session)
    await _seed_class(db_session, user, is_active = False)

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_my_classes_counts_progress(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    done = await _seed_exercise(db_session, cls.id)
    await _seed_exercise(db_session, cls.id)
    # A draft is not something the learner can act on, so it must not be counted.
    await _seed_exercise(db_session, cls.id, is_active = False)
    await _seed_submission(db_session, user, done)

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert resp.status_code == 200
    assert resp.json()[0]["exercise_count"] == 2
    assert resp.json()[0]["completed_exercise_count"] == 1


async def test_progress_counts_a_retried_exercise_once(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(db_session, cls.id)
    await _seed_submission(db_session, user, exercise, attempt_number = 1)
    await _seed_submission(db_session, user, exercise, attempt_number = 2)

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert resp.json()[0]["completed_exercise_count"] == 1


async def test_progress_ignores_another_learners_submissions(auth_client, db_session):
    user = await _seed_user(db_session)
    other = await _seed_user(db_session)
    cls = await _seed_class(db_session, user, other)
    exercise = await _seed_exercise(db_session, cls.id)
    await _seed_submission(db_session, other, exercise)

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert resp.json()[0]["completed_exercise_count"] == 0


async def test_my_classes_requires_authentication(auth_client):
    resp = await auth_client.get(f"{BASE}/me")
    assert resp.status_code == 401


# Regression guard: /classes/me must be routed before /classes/{class_id}, which
# is admin-only and would otherwise swallow "me" as a bad UUID.
async def test_me_is_not_matched_as_a_class_id(auth_client, db_session):
    user = await _seed_user(db_session)
    await _seed_class(db_session, user)

    resp = await auth_client.get(f"{BASE}/me", headers = _auth(user))
    assert resp.status_code == 200


# --------------------------------------------------------------------------
# GET /classes/{class_id}/exercises
# --------------------------------------------------------------------------

async def test_class_exercises_reports_attempt_state(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    attempted = await _seed_exercise(db_session, cls.id)
    untouched = await _seed_exercise(db_session, cls.id)
    await _seed_submission(db_session, user, attempted, score = 2, is_passed = True)

    resp = await auth_client.get(
        f"{BASE}/{cls.id}/exercises", headers = _auth(user)
    )
    assert resp.status_code == 200
    by_id = {e["id"]: e for e in resp.json()}

    assert by_id[str(attempted.id)]["attempt_count"] == 1
    assert by_id[str(attempted.id)]["best_score"] == 2
    assert by_id[str(attempted.id)]["is_passed"] is True

    assert by_id[str(untouched.id)]["attempt_count"] == 0
    assert by_id[str(untouched.id)]["best_score"] is None
    assert by_id[str(untouched.id)]["is_passed"] is None
    assert by_id[str(untouched.id)]["question_count"] == 2


async def test_best_score_is_the_highest_attempt(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    exercise = await _seed_exercise(db_session, cls.id)
    await _seed_submission(
        db_session, user, exercise, score = 1, is_passed = False, attempt_number = 1
    )
    await _seed_submission(
        db_session, user, exercise, score = 2, is_passed = True, attempt_number = 2
    )

    resp = await auth_client.get(f"{BASE}/{cls.id}/exercises", headers = _auth(user))
    body = resp.json()[0]
    assert body["attempt_count"] == 2
    assert body["best_score"] == 2
    # bool_or: "has ever passed", not "passed last time".
    assert body["is_passed"] is True


async def test_class_exercises_excludes_drafts(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await _seed_exercise(db_session, cls.id, is_active = False)

    resp = await auth_client.get(f"{BASE}/{cls.id}/exercises", headers = _auth(user))
    assert resp.status_code == 200
    assert resp.json() == []


async def test_class_exercises_rejects_a_non_member(auth_client, db_session):
    member = await _seed_user(db_session)
    outsider = await _seed_user(db_session)
    cls = await _seed_class(db_session, member)
    await _seed_exercise(db_session, cls.id)

    resp = await auth_client.get(
        f"{BASE}/{cls.id}/exercises", headers = _auth(outsider)
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "You are not a member of this class."}


async def test_class_exercises_requires_authentication(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await _seed_exercise(db_session, cls.id)

    resp = await auth_client.get(f"{BASE}/{cls.id}/exercises")
    assert resp.status_code == 401


async def test_class_exercises_never_exposes_question_content(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    await _seed_exercise(db_session, cls.id)

    resp = await auth_client.get(f"{BASE}/{cls.id}/exercises", headers = _auth(user))
    raw = resp.text
    assert "is_correct" not in raw
    assert "question_text" not in raw


# --------------------------------------------------------------------------
# skill_names — only honest for a single-document exercise
# --------------------------------------------------------------------------

async def test_single_document_exercise_lists_its_skills(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    first = await _seed_skill(db_session, "Alpha")
    second = await _seed_skill(db_session, "Beta")
    document = await _seed_document(db_session, [second, first])
    await _seed_exercise(db_session, cls.id, documents = [document])

    resp = await auth_client.get(f"{BASE}/{cls.id}/exercises", headers = _auth(user))
    assert resp.status_code == 200
    assert resp.json()[0]["skill_names"] == ["Alpha", "Beta"]


# A multi-document exam awards no skill points at all, so advertising skills for
# one would promise something the scoring engine never delivers.
async def test_multi_document_exercise_lists_no_skills(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    skill = await _seed_skill(db_session, "Alpha")
    first = await _seed_document(db_session, [skill])
    second = await _seed_document(db_session, [skill])
    await _seed_exercise(db_session, cls.id, documents = [first, second])

    resp = await auth_client.get(f"{BASE}/{cls.id}/exercises", headers = _auth(user))
    assert resp.status_code == 200
    assert resp.json()[0]["skill_names"] == []


async def test_untagged_document_lists_no_skills(auth_client, db_session):
    user = await _seed_user(db_session)
    cls = await _seed_class(db_session, user)
    document = await _seed_document(db_session)
    await _seed_exercise(db_session, cls.id, documents = [document])

    resp = await auth_client.get(f"{BASE}/{cls.id}/exercises", headers = _auth(user))
    assert resp.json()[0]["skill_names"] == []
