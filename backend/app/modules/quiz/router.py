from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_admin
from app.modules.auth.models import User
from app.modules.quiz.schemas import (
    DailyQuizConfigCreate,
    DailyQuizConfigResponse,
    DailyQuizConfigUpdate,
)
from app.modules.quiz.service import DailyQuizConfigService

router = APIRouter()

daily_quiz_configs_router = APIRouter(
    prefix = "/daily-quiz-configs",
    tags = ["Daily Quiz — Configs"],
    dependencies = [Depends(require_admin)],
)


@daily_quiz_configs_router.post(
    "",
    response_model = DailyQuizConfigResponse,
    status_code = status.HTTP_201_CREATED,
)
async def create_config(
    data: DailyQuizConfigCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await DailyQuizConfigService(db).create(data, current_user.id)


@daily_quiz_configs_router.get("", response_model = list[DailyQuizConfigResponse])
async def list_configs(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
):
    return await DailyQuizConfigService(db).get_all(include_inactive)


@daily_quiz_configs_router.get(
    "/{config_id}", response_model = DailyQuizConfigResponse
)
async def get_config(config_id: UUID, db: AsyncSession = Depends(get_db)):
    return await DailyQuizConfigService(db).get_by_id(config_id)


@daily_quiz_configs_router.put(
    "/{config_id}", response_model = DailyQuizConfigResponse
)
async def update_config(
    config_id: UUID,
    data: DailyQuizConfigUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await DailyQuizConfigService(db).update(config_id, data)


@daily_quiz_configs_router.patch(
    "/{config_id}/activate", response_model = DailyQuizConfigResponse
)
async def activate_config(config_id: UUID, db: AsyncSession = Depends(get_db)):
    return await DailyQuizConfigService(db).activate(config_id)


@daily_quiz_configs_router.patch(
    "/{config_id}/deactivate", response_model = DailyQuizConfigResponse
)
async def deactivate_config(config_id: UUID, db: AsyncSession = Depends(get_db)):
    return await DailyQuizConfigService(db).deactivate(config_id)
