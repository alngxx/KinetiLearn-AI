from typing import cast
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import get_or_404

from app.modules.config.models import (
    Category,
    Department,
    EmployeeLevel,
    JobPosition,
    SeniorityLevel,
    Skill,
)
from app.modules.config.schemas import (
    CategoryCreate,
    CategoryResponse,
    CategoryUpdate,
    DepartmentCreate,
    DepartmentResponse,
    DepartmentUpdate,
    EmployeeLevelCreate,
    EmployeeLevelResponse,
    EmployeeLevelUpdate,
    JobPositionCreate,
    JobPositionResponse,
    JobPositionUpdate,
    SeniorityLevelCreate,
    SeniorityLevelResponse,
    SeniorityLevelUpdate,
    SkillCreate,
    SkillResponse,
    SkillUpdate,
)


class CategoryService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: CategoryCreate) -> CategoryResponse:
        result = await self.db.execute(
            select(Category.id).where(func.lower(Category.name) == data.name.lower())
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(status_code = 409, detail = "Category name already exists.")

        row = Category(name = data.name, description = data.description)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return CategoryResponse.model_validate(row)

    async def get_all(self, include_inactive: bool = False) -> list[CategoryResponse]:
        stmt = select(Category)
        if not include_inactive:
            stmt = stmt.where(Category.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [CategoryResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, category_id: UUID) -> CategoryResponse:
        row = await get_or_404(self.db, Category, category_id, "Category not found.")
        return CategoryResponse.model_validate(row)

    async def update(self, category_id: UUID, data: CategoryUpdate) -> CategoryResponse:
        row = await get_or_404(self.db, Category, category_id, "Category not found.")
        update_data = data.model_dump(exclude_none = True)

        new_name = update_data.get("name")
        if new_name is not None and new_name.lower() != row.name.lower():
            result = await self.db.execute(
                select(Category.id).where(
                    func.lower(Category.name) == new_name.lower(),
                    Category.id != category_id,
                )
            )
            if result.scalar_one_or_none() is not None:
                raise HTTPException(status_code = 409, detail = "Category name already exists.")

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return CategoryResponse.model_validate(row)

    async def activate(self, category_id: UUID) -> CategoryResponse:
        row = await get_or_404(self.db, Category, category_id, "Category not found.")
        row.is_active = True
        await self.db.commit()
        await self.db.refresh(row)
        return CategoryResponse.model_validate(row)

    async def deactivate(self, category_id: UUID) -> CategoryResponse:
        row = await get_or_404(self.db, Category, category_id, "Category not found.")
        result = await self.db.execute(
            select(Skill.id)
            .where(Skill.category_id == category_id, Skill.is_active.is_(True))
            .limit(1)
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code = 400,
                detail = "Cannot deactivate category with active skills.",
            )
        row.is_active = False
        await self.db.commit()
        await self.db.refresh(row)
        return CategoryResponse.model_validate(row)


class SkillService:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _check_thresholds(self, basic_max: int, intermediate_max: int) -> None:
        if intermediate_max <= basic_max:
            raise HTTPException(status_code = 422, detail = "intermediate_max must be greater than basic_max.")

    async def _name_taken(
        self,
        category_id: UUID,
        name: str,
        exclude_id: UUID | None = None,
    ) -> bool:
        stmt = select(Skill.id).where(
            Skill.category_id == category_id,
            func.lower(Skill.name) == name.lower(),
        )
        if exclude_id is not None:
            stmt = stmt.where(Skill.id != exclude_id)
        result = await self.db.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def create(self, data: SkillCreate) -> SkillResponse:
        result = await self.db.execute(
            select(Category).where(Category.id == data.category_id)
        )
        category = result.scalar_one_or_none()
        if category is None:
            raise HTTPException(status_code = 404, detail = "Category not found.")
        if not category.is_active:
            raise HTTPException(status_code = 400, detail = "Category is inactive.")

        if await self._name_taken(data.category_id, data.name):
            raise HTTPException(
                status_code = 409,
                detail = "Skill name already exists in this category.",
            )

        row = Skill(**data.model_dump())
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return SkillResponse.model_validate(row)

    async def get_all(
        self,
        category_id: UUID | None = None,
        include_inactive: bool = False,
    ) -> list[SkillResponse]:
        stmt = select(Skill)
        if category_id is not None:
            stmt = stmt.where(Skill.category_id == category_id)
        if not include_inactive:
            stmt = stmt.where(Skill.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [SkillResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, skill_id: UUID) -> SkillResponse:
        row = await get_or_404(self.db, Skill, skill_id, "Skill not found.")
        return SkillResponse.model_validate(row)

    async def update(self, skill_id: UUID, data: SkillUpdate) -> SkillResponse:
        row = await get_or_404(self.db, Skill, skill_id, "Skill not found.")
        update_data = data.model_dump(exclude_none = True)

        merged_basic_max = cast(int, update_data.get("basic_max", row.basic_max))
        merged_intermediate_max = cast(int, update_data.get("intermediate_max", row.intermediate_max))
        self._check_thresholds(merged_basic_max, merged_intermediate_max)

        new_name = update_data.get("name")
        if new_name is not None and new_name.lower() != row.name.lower():
            target_category = cast(UUID, update_data.get("category_id", row.category_id))
            if await self._name_taken(target_category, new_name, exclude_id = skill_id):
                raise HTTPException(
                    status_code = 409,
                    detail = "Skill name already exists in this category.",
                )

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return SkillResponse.model_validate(row)

    async def activate(self, skill_id: UUID) -> SkillResponse:
        row = await get_or_404(self.db, Skill, skill_id, "Skill not found.")
        row.is_active = True
        await self.db.commit()
        await self.db.refresh(row)
        return SkillResponse.model_validate(row)

    async def deactivate(self, skill_id: UUID) -> SkillResponse:
        row = await get_or_404(self.db, Skill, skill_id, "Skill not found.")
        row.is_active = False
        await self.db.commit()
        await self.db.refresh(row)
        return SkillResponse.model_validate(row)


class DepartmentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: DepartmentCreate) -> DepartmentResponse:
        result = await self.db.execute(
            select(Department.id).where(func.lower(Department.name) == data.name.lower())
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(status_code = 409, detail = "Department name already exists.")

        row = Department(name = data.name, description = data.description)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return DepartmentResponse.model_validate(row)

    async def get_all(self, include_inactive: bool = False) -> list[DepartmentResponse]:
        stmt = select(Department)
        if not include_inactive:
            stmt = stmt.where(Department.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [DepartmentResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, department_id: UUID) -> DepartmentResponse:
        row = await get_or_404(self.db, Department, department_id, "Department not found.")
        return DepartmentResponse.model_validate(row)

    async def update(self, department_id: UUID, data: DepartmentUpdate) -> DepartmentResponse:
        row = await get_or_404(self.db, Department, department_id, "Department not found.")
        update_data = data.model_dump(exclude_none = True)

        new_name = update_data.get("name")
        if new_name is not None and new_name.lower() != row.name.lower():
            result = await self.db.execute(
                select(Department.id).where(
                    func.lower(Department.name) == new_name.lower(),
                    Department.id != department_id,
                )
            )
            if result.scalar_one_or_none() is not None:
                raise HTTPException(status_code = 409, detail = "Department name already exists.")

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return DepartmentResponse.model_validate(row)

    async def activate(self, department_id: UUID) -> DepartmentResponse:
        row = await get_or_404(self.db, Department, department_id, "Department not found.")
        row.is_active = True
        await self.db.commit()
        await self.db.refresh(row)
        return DepartmentResponse.model_validate(row)

    async def deactivate(self, department_id: UUID) -> DepartmentResponse:
        row = await get_or_404(self.db, Department, department_id, "Department not found.")
        row.is_active = False
        await self.db.commit()
        await self.db.refresh(row)
        return DepartmentResponse.model_validate(row)


class SeniorityLevelService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _name_taken(self, name: str, exclude_id: UUID | None = None) -> bool:
        stmt = select(SeniorityLevel.id).where(
            func.lower(SeniorityLevel.name) == name.lower()
        )
        if exclude_id is not None:
            stmt = stmt.where(SeniorityLevel.id != exclude_id)
        result = await self.db.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def _rank_taken(self, rank: int, exclude_id: UUID | None = None) -> bool:
        stmt = select(SeniorityLevel.id).where(SeniorityLevel.rank == rank)
        if exclude_id is not None:
            stmt = stmt.where(SeniorityLevel.id != exclude_id)
        result = await self.db.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def create(self, data: SeniorityLevelCreate) -> SeniorityLevelResponse:
        if await self._name_taken(data.name):
            raise HTTPException(status_code = 409, detail = "Seniority level name already exists.")
        if await self._rank_taken(data.rank):
            raise HTTPException(status_code = 409, detail = "Seniority level rank already exists.")

        row = SeniorityLevel(name = data.name, rank = data.rank)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return SeniorityLevelResponse.model_validate(row)

    async def get_all(self, include_inactive: bool = False) -> list[SeniorityLevelResponse]:
        stmt = select(SeniorityLevel)
        if not include_inactive:
            stmt = stmt.where(SeniorityLevel.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [SeniorityLevelResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, level_id: UUID) -> SeniorityLevelResponse:
        row = await get_or_404(self.db, SeniorityLevel, level_id, "Seniority level not found.")
        return SeniorityLevelResponse.model_validate(row)

    async def update(self, level_id: UUID, data: SeniorityLevelUpdate) -> SeniorityLevelResponse:
        row = await get_or_404(self.db, SeniorityLevel, level_id, "Seniority level not found.")
        update_data = data.model_dump(exclude_none = True)

        new_name = update_data.get("name")
        if new_name is not None and new_name.lower() != row.name.lower():
            if await self._name_taken(new_name, exclude_id = level_id):
                raise HTTPException(status_code = 409, detail = "Seniority level name already exists.")

        new_rank = update_data.get("rank")
        if new_rank is not None and new_rank != row.rank:
            if await self._rank_taken(new_rank, exclude_id = level_id):
                raise HTTPException(status_code = 409, detail = "Seniority level rank already exists.")

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return SeniorityLevelResponse.model_validate(row)

    async def activate(self, level_id: UUID) -> SeniorityLevelResponse:
        row = await get_or_404(self.db, SeniorityLevel, level_id, "Seniority level not found.")
        row.is_active = True
        await self.db.commit()
        await self.db.refresh(row)
        return SeniorityLevelResponse.model_validate(row)

    async def deactivate(self, level_id: UUID) -> SeniorityLevelResponse:
        row = await get_or_404(self.db, SeniorityLevel, level_id, "Seniority level not found.")
        row.is_active = False
        await self.db.commit()
        await self.db.refresh(row)
        return SeniorityLevelResponse.model_validate(row)


class JobPositionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, data: JobPositionCreate) -> JobPositionResponse:
        result = await self.db.execute(
            select(JobPosition.id).where(func.lower(JobPosition.name) == data.name.lower())
        )
        if result.scalar_one_or_none() is not None:
            raise HTTPException(status_code = 409, detail = "Job position name already exists.")

        row = JobPosition(name = data.name, description = data.description)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return JobPositionResponse.model_validate(row)

    async def get_all(self, include_inactive: bool = False) -> list[JobPositionResponse]:
        stmt = select(JobPosition)
        if not include_inactive:
            stmt = stmt.where(JobPosition.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [JobPositionResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, job_position_id: UUID) -> JobPositionResponse:
        row = await get_or_404(self.db, JobPosition, job_position_id, "Job position not found.")
        return JobPositionResponse.model_validate(row)

    async def update(self, job_position_id: UUID, data: JobPositionUpdate) -> JobPositionResponse:
        row = await get_or_404(self.db, JobPosition, job_position_id, "Job position not found.")
        update_data = data.model_dump(exclude_none = True)

        new_name = update_data.get("name")
        if new_name is not None and new_name.lower() != row.name.lower():
            result = await self.db.execute(
                select(JobPosition.id).where(
                    func.lower(JobPosition.name) == new_name.lower(),
                    JobPosition.id != job_position_id,
                )
            )
            if result.scalar_one_or_none() is not None:
                raise HTTPException(status_code = 409, detail = "Job position name already exists.")

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return JobPositionResponse.model_validate(row)

    async def activate(self, job_position_id: UUID) -> JobPositionResponse:
        row = await get_or_404(self.db, JobPosition, job_position_id, "Job position not found.")
        row.is_active = True
        await self.db.commit()
        await self.db.refresh(row)
        return JobPositionResponse.model_validate(row)

    async def deactivate(self, job_position_id: UUID) -> JobPositionResponse:
        row = await get_or_404(self.db, JobPosition, job_position_id, "Job position not found.")
        row.is_active = False
        await self.db.commit()
        await self.db.refresh(row)
        return JobPositionResponse.model_validate(row)


class EmployeeLevelService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _name_taken(self, name: str, exclude_id: UUID | None = None) -> bool:
        stmt = select(EmployeeLevel.id).where(
            func.lower(EmployeeLevel.name) == name.lower()
        )
        if exclude_id is not None:
            stmt = stmt.where(EmployeeLevel.id != exclude_id)
        result = await self.db.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def _rank_taken(self, rank: int, exclude_id: UUID | None = None) -> bool:
        stmt = select(EmployeeLevel.id).where(EmployeeLevel.rank == rank)
        if exclude_id is not None:
            stmt = stmt.where(EmployeeLevel.id != exclude_id)
        result = await self.db.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def create(self, data: EmployeeLevelCreate) -> EmployeeLevelResponse:
        if await self._name_taken(data.name):
            raise HTTPException(status_code = 409, detail = "Employee level name already exists.")
        if await self._rank_taken(data.rank):
            raise HTTPException(status_code = 409, detail = "Employee level rank already exists.")

        row = EmployeeLevel(name = data.name, rank = data.rank)
        self.db.add(row)
        await self.db.commit()
        await self.db.refresh(row)
        return EmployeeLevelResponse.model_validate(row)

    async def get_all(self, include_inactive: bool = False) -> list[EmployeeLevelResponse]:
        stmt = select(EmployeeLevel)
        if not include_inactive:
            stmt = stmt.where(EmployeeLevel.is_active.is_(True))
        result = await self.db.execute(stmt)
        return [EmployeeLevelResponse.model_validate(row) for row in result.scalars().all()]

    async def get_by_id(self, employee_level_id: UUID) -> EmployeeLevelResponse:
        row = await get_or_404(self.db, EmployeeLevel, employee_level_id, "Employee level not found.")
        return EmployeeLevelResponse.model_validate(row)

    async def update(self, employee_level_id: UUID, data: EmployeeLevelUpdate) -> EmployeeLevelResponse:
        row = await get_or_404(self.db, EmployeeLevel, employee_level_id, "Employee level not found.")
        update_data = data.model_dump(exclude_none = True)

        new_name = update_data.get("name")
        if new_name is not None and new_name.lower() != row.name.lower():
            if await self._name_taken(new_name, exclude_id = employee_level_id):
                raise HTTPException(status_code = 409, detail = "Employee level name already exists.")

        new_rank = update_data.get("rank")
        if new_rank is not None and new_rank != row.rank:
            if await self._rank_taken(new_rank, exclude_id = employee_level_id):
                raise HTTPException(status_code = 409, detail = "Employee level rank already exists.")

        for key, value in update_data.items():
            setattr(row, key, value)
        await self.db.commit()
        await self.db.refresh(row)
        return EmployeeLevelResponse.model_validate(row)

    async def activate(self, employee_level_id: UUID) -> EmployeeLevelResponse:
        row = await get_or_404(self.db, EmployeeLevel, employee_level_id, "Employee level not found.")
        row.is_active = True
        await self.db.commit()
        await self.db.refresh(row)
        return EmployeeLevelResponse.model_validate(row)

    async def deactivate(self, employee_level_id: UUID) -> EmployeeLevelResponse:
        row = await get_or_404(self.db, EmployeeLevel, employee_level_id, "Employee level not found.")
        row.is_active = False
        await self.db.commit()
        await self.db.refresh(row)
        return EmployeeLevelResponse.model_validate(row)
