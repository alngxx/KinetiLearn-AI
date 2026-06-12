from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_admin
from app.modules.config.schemas import (
    CategoryCreate,
    CategoryResponse,
    CategoryUpdate,
    SkillCreate,
    SkillResponse,
    SkillUpdate,
)
from app.modules.config.service import CategoryService, SkillService

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