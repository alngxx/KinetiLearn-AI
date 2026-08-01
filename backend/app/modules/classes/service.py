from datetime import date
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import get_or_404
from app.modules.auth.models import User
from app.modules.classes.models import Class, ClassMember
from app.modules.classes.schemas import (
    BulkAddMembersRequest,
    BulkAddMembersResponse,
    ClassCreate,
    ClassDetailResponse,
    ClassExerciseSummary,
    ClassResponse,
    ClassUpdate,
)
from app.modules.exams.models import Exercise


class ClassService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _check_dates(self, start_date: date | None, end_date: date | None) -> None:
        # Mirrors the ck_classes_end_date_after_start_date CHECK so a bad range
        # returns {"detail": ...} instead of a raw IntegrityError.
        if start_date is not None and end_date is not None and end_date < start_date:
            raise HTTPException(
                status_code = 400, detail = "end_date must be on or after start_date."
            )

    async def create(self, data: ClassCreate, creator_id: UUID | None) -> ClassResponse:
        self._check_dates(data.start_date, data.end_date)

        row = Class(
            name = data.name,
            description = data.description,
            start_date = data.start_date,
            end_date = data.end_date,
            created_by = creator_id,
        )
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return ClassResponse.model_validate(row)

    async def get_all(self, include_inactive: bool = False) -> list[ClassResponse]:
        stmt = select(Class).order_by(Class.created_at.desc())
        if not include_inactive:
            stmt = stmt.where(Class.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [ClassResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, class_id: UUID) -> ClassDetailResponse:
        row = await get_or_404(self.db, Class, class_id, "Class not found.")

        member_count = await self.db.scalar(
            select(func.count())
            .select_from(ClassMember)
            .where(ClassMember.class_id == class_id)
        )
        result = await self.db.execute(
            select(Exercise)
            .where(Exercise.class_id == class_id)
            .order_by(Exercise.end_time)
        )
        exercises = [
            ClassExerciseSummary.model_validate(e) for e in result.scalars().all()
        ]

        return ClassDetailResponse(
            **ClassResponse.model_validate(row).model_dump(),
            member_count = member_count or 0,
            exercises = exercises,
        )

    async def update(self, class_id: UUID, data: ClassUpdate) -> ClassResponse:
        row = await get_or_404(self.db, Class, class_id, "Class not found.")
        update_data = data.model_dump(exclude_none = True)

        # Validate against the values the row will actually end up with.
        self._check_dates(
            update_data.get("start_date", row.start_date),
            update_data.get("end_date", row.end_date),
        )

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return ClassResponse.model_validate(row)

    async def activate(self, class_id: UUID) -> ClassResponse:
        return await self._set_active(class_id, True)

    async def deactivate(self, class_id: UUID) -> ClassResponse:
        return await self._set_active(class_id, False)

    async def _set_active(self, class_id: UUID, is_active: bool) -> ClassResponse:
        # Visibility flag only — members and exercises are left untouched.
        row = await get_or_404(self.db, Class, class_id, "Class not found.")
        row.is_active = is_active
        await self.db.commit()
        await self.db.refresh(row)
        return ClassResponse.model_validate(row)

    async def bulk_add_members(
        self, class_id: UUID, data: BulkAddMembersRequest
    ) -> BulkAddMembersResponse:
        await get_or_404(self.db, Class, class_id, "Class not found.")

        filters = []
        if data.department_id is not None:
            filters.append(User.department_id == data.department_id)
        if data.employee_level_id is not None:
            filters.append(User.employee_level_id == data.employee_level_id)
        if data.seniority_id is not None:
            filters.append(User.seniority_id == data.seniority_id)
        if not filters:
            raise HTTPException(
                status_code = 400, detail = "At least one filter is required."
            )

        result = await self.db.execute(
            select(User.id).where(
                User.role == "learner",
                User.is_active.is_(True),
                *filters,
            )
        )
        matched = set(result.scalars().all())

        result = await self.db.execute(
            select(ClassMember.user_id).where(ClassMember.class_id == class_id)
        )
        existing = set(result.scalars().all())

        # Already-members are skipped, so re-running the same filter is a no-op.
        to_add = matched - existing
        self.db.add_all(
            [ClassMember(class_id = class_id, user_id = uid) for uid in to_add]
        )
        await self.db.commit()

        return BulkAddMembersResponse(
            total_matched = len(matched),
            added = len(to_add),
            skipped = len(matched) - len(to_add),
        )
