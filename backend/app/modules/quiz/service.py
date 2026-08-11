import asyncio
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import cast
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.crud import get_or_404
from app.core.llm import generate_quiz
from app.modules.auth.models import User
from app.modules.config.models import (
    Department,
    EmployeeLevel,
    JobPosition,
    SeniorityLevel,
)
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.quiz.models import (
    DailyQuiz,
    DailyQuizConfig,
    DailyQuizQuestion,
    DailyQuizQuestionOption,
)
from app.modules.quiz.schemas import (
    DailyQuizConfigCreate,
    DailyQuizConfigResponse,
    DailyQuizConfigUpdate,
)

NOT_FOUND = "Daily quiz config not found."

# Each target column with the model it points at, so validation and the error
# message stay in one place.
TARGET_MODELS = {
    "target_department_id": (Department, "Department not found."),
    "target_seniority_id": (SeniorityLevel, "Seniority level not found."),
    "target_job_position_id": (JobPosition, "Job position not found."),
    "target_employee_level_id": (EmployeeLevel, "Employee level not found."),
}


class DailyQuizConfigService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _check_dates(self, start_date: date, end_date: date | None) -> None:
        # Mirrors the ck_daily_quiz_configs_end_date_after_start CHECK so a bad
        # range returns {"detail": ...} instead of a raw IntegrityError.
        if end_date is not None and end_date < start_date:
            raise HTTPException(
                status_code = 400, detail = "end_date must be on or after start_date."
            )

    def _check_timezone(self, timezone: str) -> None:
        # A typo would only surface later, as a scheduler that never fires.
        try:
            ZoneInfo(timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(status_code = 400, detail = "Unknown timezone.")

    async def _check_document(self, document_id: UUID) -> None:
        # Same eligibility rule the chatbot and exam generator use: a live
        # document with a promoted version that finished processing.
        document = await get_or_404(
            self.db, Document, document_id, "Document not found."
        )
        if not document.is_active:
            raise HTTPException(status_code = 400, detail = "Document is inactive.")
        if document.active_version_number is None:
            raise HTTPException(status_code = 400, detail = "Document is not ready.")

        version = await self.db.get(
            DocumentVersion, (document_id, document.active_version_number)
        )
        if version is None or version.processing_status != "ready":
            raise HTTPException(status_code = 400, detail = "Document is not ready.")

    async def _check_targets(self, data: dict) -> None:
        # The target columns are real FKs, so an unknown id would fail as a 500
        # at commit time instead of a clean 404.
        for field, (model, detail) in TARGET_MODELS.items():
            target_id = data.get(field)
            if target_id is None:
                continue
            result = await self.db.execute(select(model.id).where(model.id == target_id))
            if result.scalar_one_or_none() is None:
                raise HTTPException(status_code = 404, detail = detail)

    async def create(
        self, data: DailyQuizConfigCreate, creator_id: UUID | None
    ) -> DailyQuizConfigResponse:
        self._check_dates(data.start_date, data.end_date)
        self._check_timezone(data.timezone)
        await self._check_document(data.source_document_id)
        await self._check_targets(data.model_dump())

        row = DailyQuizConfig(**data.model_dump(), created_by = creator_id)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return DailyQuizConfigResponse.model_validate(row)

    async def get_all(
        self, include_inactive: bool = False
    ) -> list[DailyQuizConfigResponse]:
        stmt = select(DailyQuizConfig).order_by(DailyQuizConfig.created_at.desc())
        if not include_inactive:
            stmt = stmt.where(DailyQuizConfig.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [
            DailyQuizConfigResponse.model_validate(row)
            for row in result.scalars().all()
        ]

    async def get_by_id(self, config_id: UUID) -> DailyQuizConfigResponse:
        row = await get_or_404(self.db, DailyQuizConfig, config_id, NOT_FOUND)
        return DailyQuizConfigResponse.model_validate(row)

    async def update(
        self, config_id: UUID, data: DailyQuizConfigUpdate
    ) -> DailyQuizConfigResponse:
        row = await get_or_404(self.db, DailyQuizConfig, config_id, NOT_FOUND)
        update_data = data.model_dump(exclude_none = True)

        # Validate against the values the row will actually end up with.
        self._check_dates(
            cast(date, update_data.get("start_date", row.start_date)),
            update_data.get("end_date", row.end_date),
        )
        if "timezone" in update_data:
            self._check_timezone(update_data["timezone"])
        if "source_document_id" in update_data:
            await self._check_document(update_data["source_document_id"])
        await self._check_targets(update_data)

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return DailyQuizConfigResponse.model_validate(row)

    async def activate(self, config_id: UUID) -> DailyQuizConfigResponse:
        return await self._set_active(config_id, True)

    async def deactivate(self, config_id: UUID) -> DailyQuizConfigResponse:
        return await self._set_active(config_id, False)

    async def _set_active(
        self, config_id: UUID, is_active: bool
    ) -> DailyQuizConfigResponse:
        row = await get_or_404(self.db, DailyQuizConfig, config_id, NOT_FOUND)
        row.is_active = is_active
        await self.db.commit()
        await self.db.refresh(row)
        return DailyQuizConfigResponse.model_validate(row)


# ---------------------------------------------------------------------------
# Daily quiz generation (Task 29).
#
# Everything below runs in the Celery worker on a SYNC session, unlike the async
# service above. Kept in this module so all daily-quiz logic lives together, but
# the two halves share no state and must not call each other.
# ---------------------------------------------------------------------------

MAX_CONTEXT_CHUNKS = 120
OPTION_LABELS = "ABCDEFGHIJ"
QUESTION_POINTS = 1

_loop = None


def _run_async(coro):
    # One event loop for the life of the worker process. asyncio.run() would close
    # the loop after each call, which strands the cached AsyncOpenAI client's
    # connection pool on a dead loop and breaks every config after the first.
    # Created lazily so it belongs to the forked child, not the parent process.
    global _loop
    if _loop is None:
        _loop = asyncio.new_event_loop()
    return _loop.run_until_complete(coro)


@dataclass
class DueConfig:
    config: DailyQuizConfig
    quiz_date: date
    push_instant: datetime


def find_due_configs(session: Session, now_utc: datetime) -> list[DueConfig]:
    """Active configs whose push_time has passed today and have no quiz yet.

    now_utc is a parameter rather than read from the clock so tests can pick any
    instant. The rule is "past push_time and not generated" instead of a narrow
    time window, so a worker outage delays a quiz instead of losing it.
    """
    configs = session.execute(
        select(DailyQuizConfig).where(DailyQuizConfig.is_active.is_(True))
    ).scalars().all()

    due = []
    for config in configs:
        tz = ZoneInfo(config.timezone)
        local_now = now_utc.astimezone(tz)
        quiz_date = local_now.date()

        if quiz_date < config.start_date:
            continue
        if config.end_date is not None and quiz_date > config.end_date:
            continue
        if local_now.time() < config.push_time:
            continue

        exists = session.execute(
            select(DailyQuiz.id).where(
                DailyQuiz.config_id == config.id,
                DailyQuiz.quiz_date == quiz_date,
            )
        ).scalar_one_or_none()
        if exists is not None:
            continue

        push_instant = datetime.combine(quiz_date, config.push_time, tzinfo = tz)
        due.append(DueConfig(config, quiz_date, push_instant))
    return due


def count_matching_learners(session: Session, config: DailyQuizConfig) -> int:
    # Same AND-filter shape as the class bulk-add: every set target must match.
    # A config with no targets at all is company-wide.
    filters = []
    if config.target_department_id is not None:
        filters.append(User.department_id == config.target_department_id)
    if config.target_seniority_id is not None:
        filters.append(User.seniority_id == config.target_seniority_id)
    if config.target_job_position_id is not None:
        filters.append(User.job_position_id == config.target_job_position_id)
    if config.target_employee_level_id is not None:
        filters.append(User.employee_level_id == config.target_employee_level_id)

    return session.scalar(
        select(func.count())
        .select_from(User)
        .where(
            User.role == "learner",
            User.is_active.is_(True),
            *filters,
        )
    ) or 0


def _build_context(session: Session, config: DailyQuizConfig) -> tuple[str, int]:
    document = session.get(Document, config.source_document_id)
    if document is None or not document.is_active:
        raise ValueError("Source document is unavailable")
    if document.active_version_number is None:
        raise ValueError("Source document has no active version")

    version = session.get(
        DocumentVersion, (config.source_document_id, document.active_version_number)
    )
    if version is None or version.processing_status != "ready":
        raise ValueError("Source document active version is not ready")

    chunks = session.execute(
        select(DocumentChunk)
        .where(
            DocumentChunk.document_id == config.source_document_id,
            DocumentChunk.version_number == document.active_version_number,
        )
        .order_by(DocumentChunk.chunk_index)
        .limit(MAX_CONTEXT_CHUNKS)
    ).scalars().all()
    if not chunks:
        raise ValueError("Source document active version has no content")

    return "\n\n".join(c.content for c in chunks), document.active_version_number


def _validate_batch(generated, question_count: int) -> None:
    # Same checks the exam generator makes, but raised as ValueError — there is no
    # HTTP context in the worker to turn an HTTPException into a response.
    if len(generated) != question_count:
        raise ValueError("Generator returned the wrong number of questions")
    for gq in generated:
        if len(gq.options) < 2 or len(gq.options) > len(OPTION_LABELS):
            raise ValueError("Generator returned an unusable number of options")
        if not 0 <= gq.correct_index < len(gq.options):
            raise ValueError("Generator returned an out-of-range correct_index")


def generate_daily_quiz(session: Session, due: DueConfig) -> DailyQuiz:
    """Generate and persist one shared quiz for a config's quiz_date.

    daily_quizzes has no user_id and is unique on (config_id, quiz_date), so this
    is one quiz for the whole matched audience, not one per learner.
    """
    config = due.config
    context, version_number = _build_context(session, config)

    generated = _run_async(
        generate_quiz(context, config.prompt, config.question_count)
    )
    _validate_batch(generated, config.question_count)

    # expires_at counts from the scheduled push instant, not from now, so a late
    # catch-up run doesn't quietly extend the submission window.
    quiz = DailyQuiz(
        config_id = config.id,
        quiz_date = due.quiz_date,
        expires_at = due.push_instant + timedelta(hours = config.expiry_hours),
    )
    for order_index, gq in enumerate(generated):
        question = DailyQuizQuestion(
            source_document_id = config.source_document_id,
            source_version_number = version_number,
            question_text = gq.question_text,
            explanation = gq.explanation,
            points = QUESTION_POINTS,
            order_index = order_index,
        )
        # Shuffle the options so the correct answer isn't biased toward the
        # first position — the model tends to return correct_index = 0.
        order = list(range(len(gq.options)))
        random.shuffle(order)
        correct_pos = order.index(gq.correct_index)
        for i, src in enumerate(order):
            question.options.append(DailyQuizQuestionOption(
                option_label = OPTION_LABELS[i],
                option_text = gq.options[src],
                is_correct = (i == correct_pos),
            ))
        quiz.questions.append(question)

    # One commit for the whole graph — a quiz row with no questions would look
    # like a real quiz to every reader downstream.
    session.add(quiz)
    session.commit()
    return quiz
