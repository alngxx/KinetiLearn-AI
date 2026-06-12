from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_admin
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
from app.modules.config.service import (
    CategoryService,
    DepartmentService,
    EmployeeLevelService,
    JobPositionService,
    SeniorityLevelService,
    SkillService,
)

categories_router = APIRouter(
    prefix = "/categories",
    tags = ["Config — Categories"],
    dependencies = [Depends(require_admin)],
)

skills_router = APIRouter(
    prefix = "/skills",
    tags = ["Config — Skills"],
    dependencies = [Depends(require_admin)],
)

departments_router = APIRouter(
    prefix = "/departments",
    tags = ["Config — Departments"],
    dependencies = [Depends(require_admin)],
)

seniority_levels_router = APIRouter(
    prefix = "/seniority-levels",
    tags = ["Config — Seniority Levels"],
    dependencies = [Depends(require_admin)],
)

job_positions_router = APIRouter(
    prefix = "/job-positions",
    tags = ["Config — Job Positions"],
    dependencies = [Depends(require_admin)],
)

employee_levels_router = APIRouter(
    prefix = "/employee-levels",
    tags = ["Config — Employee Levels"],
    dependencies = [Depends(require_admin)],
)


@categories_router.post("", response_model = CategoryResponse, status_code = status.HTTP_201_CREATED)
async def create_category(data: CategoryCreate, db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).create(data)


@categories_router.get("", response_model = list[CategoryResponse])
async def list_categories(include_inactive: bool = False, db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).get_all(include_inactive)


@categories_router.get("/{category_id}", response_model = CategoryResponse)
async def get_category(category_id: UUID, db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).get_by_id(category_id)


@categories_router.put("/{category_id}", response_model = CategoryResponse)
async def update_category(category_id: UUID, data: CategoryUpdate, db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).update(category_id, data)


@categories_router.patch("/{category_id}/activate", response_model = CategoryResponse)
async def activate_category(category_id: UUID, db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).activate(category_id)


@categories_router.patch("/{category_id}/deactivate", response_model = CategoryResponse)
async def deactivate_category(category_id: UUID, db: AsyncSession = Depends(get_db)):
    return await CategoryService(db).deactivate(category_id)


@skills_router.post("", response_model = SkillResponse, status_code = status.HTTP_201_CREATED)
async def create_skill(data: SkillCreate, db: AsyncSession = Depends(get_db)):
    return await SkillService(db).create(data)


@skills_router.get("", response_model = list[SkillResponse])
async def list_skills(
    category_id: UUID | None = None,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
):
    return await SkillService(db).get_all(category_id, include_inactive)


@skills_router.get("/{skill_id}", response_model = SkillResponse)
async def get_skill(skill_id: UUID, db: AsyncSession = Depends(get_db)):
    return await SkillService(db).get_by_id(skill_id)


@skills_router.put("/{skill_id}", response_model = SkillResponse)
async def update_skill(skill_id: UUID, data: SkillUpdate, db: AsyncSession = Depends(get_db)):
    return await SkillService(db).update(skill_id, data)


@skills_router.patch("/{skill_id}/activate", response_model = SkillResponse)
async def activate_skill(skill_id: UUID, db: AsyncSession = Depends(get_db)):
    return await SkillService(db).activate(skill_id)


@skills_router.patch("/{skill_id}/deactivate", response_model = SkillResponse)
async def deactivate_skill(skill_id: UUID, db: AsyncSession = Depends(get_db)):
    return await SkillService(db).deactivate(skill_id)


@departments_router.post("", response_model = DepartmentResponse, status_code = status.HTTP_201_CREATED)
async def create_department(data: DepartmentCreate, db: AsyncSession = Depends(get_db)):
    return await DepartmentService(db).create(data)


@departments_router.get("", response_model = list[DepartmentResponse])
async def list_departments(include_inactive: bool = False, db: AsyncSession = Depends(get_db)):
    return await DepartmentService(db).get_all(include_inactive)


@departments_router.get("/{department_id}", response_model = DepartmentResponse)
async def get_department(department_id: UUID, db: AsyncSession = Depends(get_db)):
    return await DepartmentService(db).get_by_id(department_id)


@departments_router.put("/{department_id}", response_model = DepartmentResponse)
async def update_department(department_id: UUID, data: DepartmentUpdate, db: AsyncSession = Depends(get_db)):
    return await DepartmentService(db).update(department_id, data)


@departments_router.patch("/{department_id}/activate", response_model = DepartmentResponse)
async def activate_department(department_id: UUID, db: AsyncSession = Depends(get_db)):
    return await DepartmentService(db).activate(department_id)


@departments_router.patch("/{department_id}/deactivate", response_model = DepartmentResponse)
async def deactivate_department(department_id: UUID, db: AsyncSession = Depends(get_db)):
    return await DepartmentService(db).deactivate(department_id)


@seniority_levels_router.post("", response_model = SeniorityLevelResponse, status_code = status.HTTP_201_CREATED)
async def create_seniority_level(data: SeniorityLevelCreate, db: AsyncSession = Depends(get_db)):
    return await SeniorityLevelService(db).create(data)


@seniority_levels_router.get("", response_model = list[SeniorityLevelResponse])
async def list_seniority_levels(include_inactive: bool = False, db: AsyncSession = Depends(get_db)):
    return await SeniorityLevelService(db).get_all(include_inactive)


@seniority_levels_router.get("/{level_id}", response_model = SeniorityLevelResponse)
async def get_seniority_level(level_id: UUID, db: AsyncSession = Depends(get_db)):
    return await SeniorityLevelService(db).get_by_id(level_id)


@seniority_levels_router.put("/{level_id}", response_model = SeniorityLevelResponse)
async def update_seniority_level(level_id: UUID, data: SeniorityLevelUpdate, db: AsyncSession = Depends(get_db)):
    return await SeniorityLevelService(db).update(level_id, data)


@seniority_levels_router.patch("/{level_id}/activate", response_model = SeniorityLevelResponse)
async def activate_seniority_level(level_id: UUID, db: AsyncSession = Depends(get_db)):
    return await SeniorityLevelService(db).activate(level_id)


@seniority_levels_router.patch("/{level_id}/deactivate", response_model = SeniorityLevelResponse)
async def deactivate_seniority_level(level_id: UUID, db: AsyncSession = Depends(get_db)):
    return await SeniorityLevelService(db).deactivate(level_id)


@job_positions_router.post("", response_model = JobPositionResponse, status_code = status.HTTP_201_CREATED)
async def create_job_position(data: JobPositionCreate, db: AsyncSession = Depends(get_db)):
    return await JobPositionService(db).create(data)


@job_positions_router.get("", response_model = list[JobPositionResponse])
async def list_job_positions(include_inactive: bool = False, db: AsyncSession = Depends(get_db)):
    return await JobPositionService(db).get_all(include_inactive)


@job_positions_router.get("/{job_position_id}", response_model = JobPositionResponse)
async def get_job_position(job_position_id: UUID, db: AsyncSession = Depends(get_db)):
    return await JobPositionService(db).get_by_id(job_position_id)


@job_positions_router.put("/{job_position_id}", response_model = JobPositionResponse)
async def update_job_position(job_position_id: UUID, data: JobPositionUpdate, db: AsyncSession = Depends(get_db)):
    return await JobPositionService(db).update(job_position_id, data)


@job_positions_router.patch("/{job_position_id}/activate", response_model = JobPositionResponse)
async def activate_job_position(job_position_id: UUID, db: AsyncSession = Depends(get_db)):
    return await JobPositionService(db).activate(job_position_id)


@job_positions_router.patch("/{job_position_id}/deactivate", response_model = JobPositionResponse)
async def deactivate_job_position(job_position_id: UUID, db: AsyncSession = Depends(get_db)):
    return await JobPositionService(db).deactivate(job_position_id)


@employee_levels_router.post("", response_model = EmployeeLevelResponse, status_code = status.HTTP_201_CREATED)
async def create_employee_level(data: EmployeeLevelCreate, db: AsyncSession = Depends(get_db)):
    return await EmployeeLevelService(db).create(data)


@employee_levels_router.get("", response_model = list[EmployeeLevelResponse])
async def list_employee_levels(include_inactive: bool = False, db: AsyncSession = Depends(get_db)):
    return await EmployeeLevelService(db).get_all(include_inactive)


@employee_levels_router.get("/{employee_level_id}", response_model = EmployeeLevelResponse)
async def get_employee_level(employee_level_id: UUID, db: AsyncSession = Depends(get_db)):
    return await EmployeeLevelService(db).get_by_id(employee_level_id)


@employee_levels_router.put("/{employee_level_id}", response_model = EmployeeLevelResponse)
async def update_employee_level(employee_level_id: UUID, data: EmployeeLevelUpdate, db: AsyncSession = Depends(get_db)):
    return await EmployeeLevelService(db).update(employee_level_id, data)


@employee_levels_router.patch("/{employee_level_id}/activate", response_model = EmployeeLevelResponse)
async def activate_employee_level(employee_level_id: UUID, db: AsyncSession = Depends(get_db)):
    return await EmployeeLevelService(db).activate(employee_level_id)


@employee_levels_router.patch("/{employee_level_id}/deactivate", response_model = EmployeeLevelResponse)
async def deactivate_employee_level(employee_level_id: UUID, db: AsyncSession = Depends(get_db)):
    return await EmployeeLevelService(db).deactivate(employee_level_id)