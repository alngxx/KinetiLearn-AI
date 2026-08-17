import logging
import uuid
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.dependencies import get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.modules.auth.models import User
from app.modules.classes.models import Class, ClassMember
from app.modules.config.models import Category, Skill
from app.modules.documents.models import Document, DocumentSkill, DocumentVersion
from app.modules.exams.models import Exercise, Question, QuestionOption
from app.modules.quiz.models import (
    DailyQuiz,
    DailyQuizConfig,
    DailyQuizQuestion,
    DailyQuizQuestionOption,
)
from app.modules.scoring.models import SkillScore, SkillScoreHistory
from app.modules.scoring.service import SkillScoringService

SUBMISSIONS = "/api/v1/submissions"
QUIZ_SUBMISSIONS = "/api/v1/quiz/submissions"
SCORING = "/api/v1/scoring"


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


async def _seed_skill(
    db, *, basic_max = 2, intermediate_max = 4, name = None, category_name = None
):
    category = Category(name = category_name or f"Cat {uuid.uuid4()}")
    db.add(category)
    await db.flush()
    skill = Skill(
        category_id = category.id,
        name = name or f"Skill {uuid.uuid4()}",
        basic_max = basic_max,
        intermediate_max = intermediate_max,
    )
    db.add(skill)
    await db.flush()
    return skill


# questions.source_document_id is half of a composite FK into document_versions,
# so a real version row has to exist for the provenance to be storable.
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


async def _seed_exam(db, user, document, *, num_questions = 3, points = 1):
    cls = Class(name = f"Class {uuid.uuid4()}")
    db.add(cls)
    await db.flush()
    db.add(ClassMember(class_id = cls.id, user_id = user.id))

    now = datetime.now(timezone.utc)
    exercise = Exercise(
        class_id = cls.id,
        title = "Exam",
        start_time = now - timedelta(hours = 1),
        end_time = now + timedelta(hours = 1),
        duration_minutes = 60,
        pass_score = 0,
        total_points = num_questions * points,
        is_active = True,
    )
    for i in range(num_questions):
        question = Question(
            source_document_id = None if document is None else document.id,
            source_version_number = None if document is None else 1,
            question_text = f"Q{i}?",
            points = points,
            order_index = i,
        )
        # Option A is always the correct one.
        for label, correct in (("A", True), ("B", False)):
            question.options.append(QuestionOption(
                option_label = label,
                option_text = f"{label} text",
                is_correct = correct,
            ))
        exercise.questions.append(question)
    db.add(exercise)
    await db.flush()
    return exercise


async def _seed_quiz(db, document, *, num_questions = 3, points = 1):
    config = DailyQuizConfig(
        name = f"Config {uuid.uuid4()}",
        prompt = "Ask about safety.",
        source_document_id = document.id,
        start_date = date(2020, 1, 1),
        push_time = time(8, 0),
        timezone = "UTC",
    )
    db.add(config)
    await db.flush()

    quiz = DailyQuiz(
        config_id = config.id,
        quiz_date = date.today(),
        expires_at = datetime.now(timezone.utc) + timedelta(hours = 1),
    )
    for i in range(num_questions):
        question = DailyQuizQuestion(
            source_document_id = document.id,
            source_version_number = 1,
            question_text = f"Q{i}?",
            points = points,
            order_index = i,
        )
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


def _exam_answers(exercise, label = "A"):
    return [
        {
            "question_id": str(q.id),
            "selected_option_id": str(
                next(o.id for o in q.options if o.option_label == label)
            ),
        }
        for q in exercise.questions
    ]


def _quiz_answers(quiz, label = "A"):
    return [
        {
            "daily_quiz_question_id": str(q.id),
            "selected_option_id": str(
                next(o.id for o in q.options if o.option_label == label)
            ),
        }
        for q in quiz.questions
    ]


async def _submit_exam(client, user, exercise, label = "A"):
    return await client.post(
        SUBMISSIONS,
        json = {
            "exercise_id": str(exercise.id),
            "answers": _exam_answers(exercise, label),
        },
        headers = _auth(user),
    )


async def _submit_quiz(client, user, quiz, label = "A"):
    return await client.post(
        QUIZ_SUBMISSIONS,
        json = {"daily_quiz_id": str(quiz.id), "answers": _quiz_answers(quiz, label)},
        headers = _auth(user),
    )


async def _scores(db, user):
    result = await db.execute(
        select(SkillScore).where(SkillScore.user_id == user.id)
    )
    return list(result.scalars().all())


async def _history(db, user):
    result = await db.execute(
        select(SkillScoreHistory).where(SkillScoreHistory.user_id == user.id)
    )
    return list(result.scalars().all())


# --------------------------------------------------------------------------
# Exam submissions
# --------------------------------------------------------------------------

async def test_exam_submission_scores_the_documents_skill(auth_client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session)
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document)

    resp = await _submit_exam(auth_client, user, exercise)
    assert resp.status_code == 201
    assert resp.json()["score"] == 3

    scores = await _scores(db_session, user)
    assert len(scores) == 1
    assert scores[0].skill_id == skill.id
    # basic_max = 2, intermediate_max = 4, so 3 points lands in intermediate.
    assert scores[0].cumulative_score == 3
    assert scores[0].current_level == "intermediate"

    history = await _history(db_session, user)
    assert len(history) == 1
    assert history[0].score_delta == 3
    assert history[0].source_type == "exam"
    assert history[0].submission_id == uuid.UUID(resp.json()["id"])
    assert history[0].daily_quiz_submission_id is None


async def test_exam_partial_score_only_counts_correct_answers(auth_client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session)
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document)

    # Answer only the first question correctly.
    answers = _exam_answers(exercise, "B")
    answers[0] = _exam_answers(exercise, "A")[0]
    resp = await auth_client.post(
        SUBMISSIONS,
        json = {"exercise_id": str(exercise.id), "answers": answers},
        headers = _auth(user),
    )
    assert resp.status_code == 201

    scores = await _scores(db_session, user)
    assert len(scores) == 1
    assert scores[0].cumulative_score == 1
    assert scores[0].current_level == "basic"


async def test_all_wrong_exam_writes_no_scoring_rows(auth_client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session)
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document)

    resp = await _submit_exam(auth_client, user, exercise, "B")
    assert resp.status_code == 201
    assert resp.json()["score"] == 0

    # No score change means no audit row — skill_score_history records changes.
    assert await _scores(db_session, user) == []
    assert await _history(db_session, user) == []


# --------------------------------------------------------------------------
# Daily quiz submissions
# --------------------------------------------------------------------------

async def test_daily_quiz_submission_scores_the_documents_skill(auth_client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session)
    document = await _seed_document(db_session, [skill])
    quiz = await _seed_quiz(db_session, document)

    resp = await _submit_quiz(auth_client, user, quiz)
    assert resp.status_code == 201
    assert resp.json()["score"] == 3

    scores = await _scores(db_session, user)
    assert len(scores) == 1
    assert scores[0].skill_id == skill.id
    assert scores[0].cumulative_score == 3

    history = await _history(db_session, user)
    assert len(history) == 1
    assert history[0].score_delta == 3
    assert history[0].source_type == "daily_quiz"
    assert history[0].daily_quiz_submission_id == uuid.UUID(resp.json()["id"])
    assert history[0].submission_id is None


# --------------------------------------------------------------------------
# Multi-skill distribution
# --------------------------------------------------------------------------

async def test_multi_skill_document_awards_full_points_to_each_skill(
    auth_client, db_session
):
    user = await _seed_user(db_session)
    first = await _seed_skill(db_session)
    second = await _seed_skill(db_session)
    document = await _seed_document(db_session, [first, second])
    exercise = await _seed_exam(db_session, user, document)

    resp = await _submit_exam(auth_client, user, exercise)
    assert resp.status_code == 201

    scores = {s.skill_id: s for s in await _scores(db_session, user)}
    assert len(scores) == 2
    # Full points to each, not split — a 1-point question would otherwise round
    # down to nothing.
    assert scores[first.id].cumulative_score == 3
    assert scores[second.id].cumulative_score == 3

    history = await _history(db_session, user)
    assert len(history) == 2
    assert {h.score_delta for h in history} == {3}


# --------------------------------------------------------------------------
# Cumulative score and level thresholds
# --------------------------------------------------------------------------

async def test_cumulative_score_is_a_running_sum_across_submissions(
    auth_client, db_session
):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session, basic_max = 2, intermediate_max = 10)
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document)

    assert (await _submit_exam(auth_client, user, exercise)).status_code == 201
    assert (await _submit_exam(auth_client, user, exercise)).status_code == 201

    scores = await _scores(db_session, user)
    assert len(scores) == 1
    assert scores[0].cumulative_score == 6

    history = await _history(db_session, user)
    assert len(history) == 2
    assert [h.score_delta for h in history] == [3, 3]


@pytest.mark.parametrize(
    "num_questions, expected_level",
    [
        (2, "basic"),           # score == basic_max
        (3, "intermediate"),    # first point past basic_max
        (4, "intermediate"),    # score == intermediate_max
        (5, "advanced"),        # first point past intermediate_max
    ],
)
async def test_level_thresholds_at_the_boundaries(
    auth_client, db_session, num_questions, expected_level
):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session, basic_max = 2, intermediate_max = 4)
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document, num_questions = num_questions)

    resp = await _submit_exam(auth_client, user, exercise)
    assert resp.status_code == 201

    scores = await _scores(db_session, user)
    assert scores[0].cumulative_score == num_questions
    assert scores[0].current_level == expected_level


# --------------------------------------------------------------------------
# Questions with no reachable skill
# --------------------------------------------------------------------------

async def test_question_without_provenance_is_skipped_silently(auth_client, db_session):
    user = await _seed_user(db_session)
    await _seed_skill(db_session)
    exercise = await _seed_exam(db_session, user, None)

    resp = await _submit_exam(auth_client, user, exercise)
    assert resp.status_code == 201
    assert resp.json()["score"] == 3

    assert await _scores(db_session, user) == []
    assert await _history(db_session, user) == []


async def test_untagged_document_is_skipped_silently(auth_client, db_session):
    user = await _seed_user(db_session)
    document = await _seed_document(db_session)
    exercise = await _seed_exam(db_session, user, document)

    resp = await _submit_exam(auth_client, user, exercise)
    assert resp.status_code == 201

    assert await _scores(db_session, user) == []
    assert await _history(db_session, user) == []


# --------------------------------------------------------------------------
# The XOR constraint on skill_score_history
# --------------------------------------------------------------------------

async def test_every_history_row_sets_exactly_one_source_fk(auth_client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session)
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document)
    quiz = await _seed_quiz(db_session, document)

    assert (await _submit_exam(auth_client, user, exercise)).status_code == 201
    assert (await _submit_quiz(auth_client, user, quiz)).status_code == 201

    history = await _history(db_session, user)
    assert len(history) == 2
    for row in history:
        assert (row.submission_id is None) != (row.daily_quiz_submission_id is None)


@pytest.mark.parametrize(
    "source_type, submission_id, daily_quiz_submission_id",
    [
        ("exam", None, None),           # neither set
        ("daily_quiz", None, None),     # neither set
    ],
)
async def test_history_row_without_a_source_id_is_rejected(
    db_session, source_type, submission_id, daily_quiz_submission_id
):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session)

    db_session.add(SkillScoreHistory(
        user_id = user.id,
        skill_id = skill.id,
        score_delta = 1,
        source_type = source_type,
        submission_id = submission_id,
        daily_quiz_submission_id = daily_quiz_submission_id,
    ))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_history_row_with_both_source_ids_is_rejected(auth_client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session)
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document)
    quiz = await _seed_quiz(db_session, document)

    exam_resp = await _submit_exam(auth_client, user, exercise)
    quiz_resp = await _submit_quiz(auth_client, user, quiz)

    db_session.add(SkillScoreHistory(
        user_id = user.id,
        skill_id = skill.id,
        score_delta = 1,
        source_type = "exam",
        submission_id = uuid.UUID(exam_resp.json()["id"]),
        daily_quiz_submission_id = uuid.UUID(quiz_resp.json()["id"]),
    ))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


# --------------------------------------------------------------------------
# A scoring failure after a committed daily quiz submission stays discoverable
# --------------------------------------------------------------------------

async def test_daily_quiz_scoring_failure_is_logged_and_does_not_fail_submit(
    auth_client, db_session, caplog
):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session)
    document = await _seed_document(db_session, [skill])
    quiz = await _seed_quiz(db_session, document)

    with patch.object(
        SkillScoringService,
        "score_daily_quiz_submission",
        side_effect = RuntimeError("boom"),
    ):
        with caplog.at_level(logging.ERROR, logger = "app.modules.quiz.service"):
            resp = await _submit_quiz(auth_client, user, quiz)

    # The submission is already committed, so it still succeeds.
    assert resp.status_code == 201
    assert resp.json()["score"] == 3
    assert await _scores(db_session, user) == []
    assert "Skill scoring failed for daily quiz submission" in caplog.text
    assert resp.json()["id"] in caplog.text


# --------------------------------------------------------------------------
# GET /scoring/users/{user_id}/skills
#
# The breakdown is driven from skills, not skill_scores: a radar chart needs every
# active skill as an axis, and an unscored skill is exactly the "weak" one the
# learner dashboard has to surface.
# --------------------------------------------------------------------------

async def test_admin_reads_learner_skill_breakdown(client, auth_client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(
        db_session, name = "Alpha", category_name = "Technical"
    )
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document)
    assert (await _submit_exam(auth_client, user, exercise)).status_code == 201

    resp = await client.get(f"{SCORING}/users/{user.id}/skills")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["skill_id"] == str(skill.id)
    assert body[0]["skill_name"] == "Alpha"
    assert body[0]["category_id"] == str(skill.category_id)
    assert body[0]["category_name"] == "Technical"
    assert body[0]["cumulative_score"] == 3
    assert body[0]["current_level"] == "intermediate"
    # The band edges the level came from, so a chart can shade them.
    assert body[0]["basic_max"] == 2
    assert body[0]["intermediate_max"] == 4
    assert body[0]["last_updated_at"] is not None


async def test_unscored_skills_are_returned_as_zeroed_axes(client, db_session):
    user = await _seed_user(db_session)
    for name in ("Alpha", "Beta", "Gamma"):
        await _seed_skill(db_session, name = name)

    resp = await client.get(f"{SCORING}/users/{user.id}/skills")
    assert resp.status_code == 200
    body = resp.json()

    # Every active skill is an axis even with no submissions at all.
    assert [item["skill_name"] for item in body] == ["Alpha", "Beta", "Gamma"]
    for item in body:
        assert item["cumulative_score"] == 0
        assert item["current_level"] == "basic"
        assert item["last_updated_at"] is None


async def test_breakdown_mixes_scored_and_unscored_skills(
    client, auth_client, db_session
):
    user = await _seed_user(db_session)
    scored = await _seed_skill(db_session, name = "Alpha")
    await _seed_skill(db_session, name = "Beta")
    document = await _seed_document(db_session, [scored])
    exercise = await _seed_exam(db_session, user, document)
    assert (await _submit_exam(auth_client, user, exercise)).status_code == 201

    resp = await client.get(f"{SCORING}/users/{user.id}/skills")
    body = {item["skill_name"]: item for item in resp.json()}
    assert set(body) == {"Alpha", "Beta"}
    assert body["Alpha"]["cumulative_score"] == 3
    assert body["Beta"]["cumulative_score"] == 0
    assert body["Beta"]["current_level"] == "basic"


async def test_breakdown_excludes_deactivated_skills(client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session, name = "Alpha")
    skill.is_active = False
    await db_session.flush()

    resp = await client.get(f"{SCORING}/users/{user.id}/skills")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_breakdown_is_empty_when_no_skills_are_configured(client, db_session):
    user = await _seed_user(db_session)
    resp = await client.get(f"{SCORING}/users/{user.id}/skills")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_breakdown_404s_for_an_unknown_user(client):
    resp = await client.get(f"{SCORING}/users/{uuid.uuid4()}/skills")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "User not found."}


async def test_breakdown_is_admin_only(auth_client, db_session):
    learner = await _seed_user(db_session)
    resp = await auth_client.get(
        f"{SCORING}/users/{learner.id}/skills", headers = _auth(learner)
    )
    assert resp.status_code == 403


# --------------------------------------------------------------------------
# GET /scoring/me/skills
# --------------------------------------------------------------------------

async def test_learner_reads_their_own_breakdown(auth_client, db_session):
    user = await _seed_user(db_session)
    skill = await _seed_skill(db_session, name = "Alpha")
    await _seed_skill(db_session, name = "Beta")
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, user, document)
    assert (await _submit_exam(auth_client, user, exercise)).status_code == 201

    resp = await auth_client.get(f"{SCORING}/me/skills", headers = _auth(user))
    assert resp.status_code == 200
    body = {item["skill_name"]: item for item in resp.json()}
    assert body["Alpha"]["cumulative_score"] == 3
    assert body["Beta"]["cumulative_score"] == 0


async def test_my_breakdown_is_scoped_to_the_caller(auth_client, db_session):
    user = await _seed_user(db_session)
    other = await _seed_user(db_session)
    skill = await _seed_skill(db_session, name = "Alpha")
    document = await _seed_document(db_session, [skill])
    exercise = await _seed_exam(db_session, other, document)
    assert (await _submit_exam(auth_client, other, exercise)).status_code == 201

    # The other learner's score must not leak into the caller's own breakdown.
    resp = await auth_client.get(f"{SCORING}/me/skills", headers = _auth(user))
    assert resp.status_code == 200
    assert resp.json()[0]["cumulative_score"] == 0


async def test_my_breakdown_requires_authentication(auth_client):
    resp = await auth_client.get(f"{SCORING}/me/skills")
    assert resp.status_code == 401
