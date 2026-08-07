from datetime import date
from typing import cast
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import get_or_404
from app.modules.config.models import (
    Department,
    EmployeeLevel,
    JobPosition,
    SeniorityLevel,
)
from app.modules.documents.models import Document, DocumentVersion
from app.modules.quiz.models import DailyQuizConfig
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
