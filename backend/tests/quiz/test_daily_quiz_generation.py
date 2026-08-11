import asyncio
import uuid
from datetime import date, datetime, time, timezone
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine, delete
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

import worker.tasks as tasks
from app.core.config import settings
from app.core.llm import GeneratedQuestion, LLMError
from app.modules.auth.models import User
from app.modules.config.models import Department
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.quiz import service
from app.modules.quiz.models import DailyQuiz, DailyQuizConfig

# The worker runs on its own sync (psycopg2) session, so these tests follow the
# same approach as tests/documents/test_worker_activate.py: point SyncSessionLocal
# at the test DB, seed rows, call the task directly, then clean up committed rows.
sync_url = (
    make_url(settings.DATABASE_URL)
    .set(database = "KinetiLearn_test")
    .set(drivername = "postgresql+psycopg2")
)


def _sessionmaker():
    engine = create_engine(sync_url)
    return sessionmaker(bind = engine, expire_on_commit = False)


class _FrozenDatetime:
    # tasks.py calls datetime.now(timezone.utc); freeze it so "today" is stable.
    def __init__(self, when):
        self._when = when

    def now(self, tz = None):
        return self._when.astimezone(tz) if tz else self._when


def _at(*args):
    return datetime(*args, tzinfo = timezone.utc)


def _fake_questions(count):
    return [
        GeneratedQuestion(
            question_text = f"Q{i}?",
            explanation = f"Because {i}.",
            options = ["right", "wrong1", "wrong2", "wrong3"],
            correct_index = 0,
        )
        for i in range(count)
    ]


def _seed_document(s):
    doc_id = uuid.uuid4()
    s.add(Document(id = doc_id, title = f"Doc {doc_id}", active_version_number = 1))
    s.add(DocumentVersion(
        document_id = doc_id,
        version_number = 1,
        file_url = "documents/x/v1.pdf",
        file_name = "f.pdf",
        file_size_bytes = 10,
        mime_type = "application/pdf",
        processing_status = "ready",
    ))
    s.add(DocumentChunk(
        document_id = doc_id,
        version_number = 1,
        chunk_index = 0,
        content = "Training material about workplace safety.",
    ))
    return doc_id


def _seed_config(s, doc_id, **kwargs):
    config = DailyQuizConfig(
        name = kwargs.pop("name", "Daily"),
        prompt = "Ask about safety.",
        source_document_id = doc_id,
        start_date = kwargs.pop("start_date", date(2020, 1, 1)),
        push_time = kwargs.pop("push_time", time(8, 0)),
        timezone = kwargs.pop("timezone", "UTC"),
        question_count = kwargs.pop("question_count", 2),
        expiry_hours = kwargs.pop("expiry_hours", 24),
        **kwargs,
    )
    s.add(config)
    return config


def _seed_learner(s, **kwargs):
    user = User(
        email = f"{uuid.uuid4()}@example.com",
        password_hash = "x",
        full_name = "Learner",
        role = "learner",
        **kwargs,
    )
    s.add(user)
    return user


def _cleanup(Session, config_ids = (), doc_ids = (), user_ids = (), dept_ids = ()):
    s = Session()
    for cid in config_ids:
        # Questions and options cascade from the quiz.
        s.execute(delete(DailyQuiz).where(DailyQuiz.config_id == cid))
    s.commit()
    for cid in config_ids:
        s.execute(delete(DailyQuizConfig).where(DailyQuizConfig.id == cid))
    for did in doc_ids:
        s.execute(delete(DocumentChunk).where(DocumentChunk.document_id == did))
        s.execute(delete(DocumentVersion).where(DocumentVersion.document_id == did))
        s.execute(delete(Document).where(Document.id == did))
    for uid in user_ids:
        s.execute(delete(User).where(User.id == uid))
    s.commit()
    for dept_id in dept_ids:
        s.execute(delete(Department).where(Department.id == dept_id))
    s.commit()
    s.close()


# --------------------------------------------------------------------------
# find_due_configs — the clock is injected, so none of these wait for real time
# --------------------------------------------------------------------------

async def test_not_due_before_push_time(test_engine):
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    config = _seed_config(s, doc_id, push_time = time(8, 0))
    s.commit()
    try:
        # 07:30 UTC — still half an hour to go.
        assert service.find_due_configs(s, _at(2024, 5, 1, 7, 30)) == []
    finally:
        s.close()
        _cleanup(Session, [config.id], [doc_id])


async def test_due_after_push_time(test_engine):
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    config = _seed_config(s, doc_id, push_time = time(8, 0))
    s.commit()
    try:
        due = service.find_due_configs(s, _at(2024, 5, 1, 8, 5))
        assert [d.config.id for d in due] == [config.id]
        assert due[0].quiz_date == date(2024, 5, 1)
        # push_instant is the scheduled time, not "now".
        assert due[0].push_instant == _at(2024, 5, 1, 8, 0)
    finally:
        s.close()
        _cleanup(Session, [config.id], [doc_id])


async def test_timezone_decides_whether_config_is_due(test_engine):
    # Same UTC instant: 02:00 UTC is 09:00 in Ho Chi Minh (UTC+7), so the
    # Vietnam config is past its 08:00 local push and the UTC one is not.
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    vn = _seed_config(s, doc_id, push_time = time(8, 0), timezone = "Asia/Ho_Chi_Minh")
    utc = _seed_config(s, doc_id, push_time = time(8, 0), timezone = "UTC")
    s.commit()
    try:
        due = service.find_due_configs(s, _at(2024, 5, 1, 2, 0))
        assert [d.config.id for d in due] == [vn.id]
    finally:
        s.close()
        _cleanup(Session, [vn.id, utc.id], [doc_id])


async def test_not_due_when_quiz_already_exists(test_engine):
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    config = _seed_config(s, doc_id, push_time = time(8, 0))
    s.commit()
    s.add(DailyQuiz(
        config_id = config.id,
        quiz_date = date(2024, 5, 1),
        expires_at = _at(2024, 5, 2, 8, 0),
    ))
    s.commit()
    try:
        assert service.find_due_configs(s, _at(2024, 5, 1, 9, 0)) == []
    finally:
        s.close()
        _cleanup(Session, [config.id], [doc_id])


async def test_not_due_outside_date_range(test_engine):
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    early = _seed_config(s, doc_id, start_date = date(2024, 6, 1))
    ended = _seed_config(
        s, doc_id, start_date = date(2024, 1, 1), end_date = date(2024, 4, 1)
    )
    s.commit()
    try:
        assert service.find_due_configs(s, _at(2024, 5, 1, 9, 0)) == []
    finally:
        s.close()
        _cleanup(Session, [early.id, ended.id], [doc_id])


async def test_inactive_config_not_due(test_engine):
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    config = _seed_config(s, doc_id, is_active = False)
    s.commit()
    try:
        assert service.find_due_configs(s, _at(2024, 5, 1, 9, 0)) == []
    finally:
        s.close()
        _cleanup(Session, [config.id], [doc_id])


async def test_catch_up_after_outage(test_engine):
    # Worker was down all morning. The quiz must still be generated rather than
    # silently lost, and its expiry must still count from the scheduled push time.
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    config = _seed_config(s, doc_id, push_time = time(8, 0))
    s.commit()
    try:
        due = service.find_due_configs(s, _at(2024, 5, 1, 15, 0))
        assert [d.config.id for d in due] == [config.id]
        assert due[0].push_instant == _at(2024, 5, 1, 8, 0)
    finally:
        s.close()
        _cleanup(Session, [config.id], [doc_id])


# --------------------------------------------------------------------------
# Generation. The task is run in a worker thread because it drives an event loop
# of its own, which cannot be done from inside the one pytest-asyncio is running.
# --------------------------------------------------------------------------

async def test_generates_quiz_with_questions_and_options(test_engine):
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    config = _seed_config(s, doc_id, question_count = 3, expiry_hours = 12)
    learner = _seed_learner(s)
    s.commit()
    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(
                 service, "generate_quiz", AsyncMock(return_value = _fake_questions(3))
             ), \
             patch.object(tasks, "datetime", _FrozenDatetime(_at(2024, 5, 1, 9, 0))):
            summary = await asyncio.to_thread(tasks.generate_due_daily_quizzes)

        assert summary["generated"] == [str(config.id)]

        s2 = Session()
        quiz = s2.query(DailyQuiz).filter_by(config_id = config.id).one()
        assert quiz.quiz_date == date(2024, 5, 1)
        # Expiry counts from the scheduled 08:00 push, not the 09:00 run.
        assert quiz.expires_at == _at(2024, 5, 1, 20, 0)
        assert len(quiz.questions) == 3
        assert sorted(q.order_index for q in quiz.questions) == [0, 1, 2]
        for q in quiz.questions:
            assert len(q.options) == 4
            assert sum(1 for o in q.options if o.is_correct) == 1
            assert q.source_document_id == doc_id
            assert q.source_version_number == 1
        s2.close()
    finally:
        s.close()
        _cleanup(Session, [config.id], [doc_id], [learner.id])


async def test_running_twice_creates_one_quiz(test_engine):
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    config = _seed_config(s, doc_id)
    learner = _seed_learner(s)
    s.commit()

    def run_twice():
        return tasks.generate_due_daily_quizzes(), tasks.generate_due_daily_quizzes()

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(
                 service, "generate_quiz", AsyncMock(return_value = _fake_questions(2))
             ), \
             patch.object(tasks, "datetime", _FrozenDatetime(_at(2024, 5, 1, 9, 0))):
            first, second = await asyncio.to_thread(run_twice)

        assert first["generated"] == [str(config.id)]
        # The second run finds the existing quiz and never reconsiders the config.
        assert second["generated"] == []

        s2 = Session()
        assert s2.query(DailyQuiz).filter_by(config_id = config.id).count() == 1
        s2.close()
    finally:
        s.close()
        _cleanup(Session, [config.id], [doc_id], [learner.id])


async def test_one_config_failing_does_not_block_others(test_engine):
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    bad = _seed_config(s, doc_id, name = "bad")
    good = _seed_config(s, doc_id, name = "good")
    learner = _seed_learner(s)
    s.commit()

    calls = {"n": 0}

    async def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise LLMError("model exploded")
        return _fake_questions(2)

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", flaky), \
             patch.object(tasks, "datetime", _FrozenDatetime(_at(2024, 5, 1, 9, 0))):
            summary = await asyncio.to_thread(tasks.generate_due_daily_quizzes)

        assert len(summary["failed"]) == 1
        assert len(summary["generated"]) == 1

        s2 = Session()
        # The config that failed has no quiz; the other one still committed.
        failed_id = uuid.UUID(summary["failed"][0])
        generated_id = uuid.UUID(summary["generated"][0])
        assert s2.query(DailyQuiz).filter_by(config_id = failed_id).count() == 0
        assert s2.query(DailyQuiz).filter_by(config_id = generated_id).count() == 1
        s2.close()
    finally:
        s.close()
        _cleanup(Session, [bad.id, good.id], [doc_id], [learner.id])


async def test_empty_audience_skips_then_generates_once_learner_added(test_engine):
    # A config nobody matches must not burn an LLM call, and must not be recorded
    # as done either — adding a learner later the same day still gets a quiz.
    Session = _sessionmaker()
    s = Session()
    doc_id = _seed_document(s)
    dept = Department(name = f"Dept {uuid.uuid4()}")
    s.add(dept)
    s.flush()
    config = _seed_config(s, doc_id, target_department_id = dept.id)
    s.commit()

    mock_llm = AsyncMock(return_value = _fake_questions(2))
    learner_box = {}

    def run_skip_then_generate():
        first = tasks.generate_due_daily_quizzes()
        # Captured before the second run, so it can only reflect the empty-audience
        # pass — the whole point is that no LLM call was made for it.
        awaits_after_first = mock_llm.await_count

        s3 = Session()
        learner_box["learner"] = _seed_learner(s3, department_id = dept.id)
        s3.commit()
        s3.close()

        return first, awaits_after_first, tasks.generate_due_daily_quizzes()

    try:
        with patch.object(tasks, "SyncSessionLocal", Session), \
             patch.object(service, "generate_quiz", mock_llm), \
             patch.object(tasks, "datetime", _FrozenDatetime(_at(2024, 5, 1, 9, 0))):
            first, awaits_after_first, second = await asyncio.to_thread(
                run_skip_then_generate
            )

        assert first["skipped"] == [str(config.id)]
        assert first["generated"] == []
        assert awaits_after_first == 0
        # Same local day, audience now non-empty: the config was never marked done.
        assert second["generated"] == [str(config.id)]
        assert mock_llm.await_count == 1
    finally:
        s.close()
        learner = learner_box.get("learner")
        _cleanup(
            Session, [config.id], [doc_id],
            [learner.id] if learner is not None else [], [dept.id],
        )


async def test_run_async_reuses_a_single_open_loop():
    # Regression guard for the sync->async bridge: asyncio.run() would close the
    # loop after each call, stranding the cached AsyncOpenAI client's connection
    # pool on a dead loop and breaking every config after the first.
    async def current_loop():
        return asyncio.get_running_loop()

    def two_calls():
        return service._run_async(current_loop()), service._run_async(current_loop())

    first, second = await asyncio.to_thread(two_calls)

    assert first is second
    assert not first.is_closed()
