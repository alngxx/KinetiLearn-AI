from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_admin
from app.modules.auth.models import User
from app.modules.scoring.schemas import SkillBreakdownItem
from app.modules.scoring.service import SkillScoringService

router = APIRouter()


@router.get("/me/skills", response_model = list[SkillBreakdownItem])
async def get_my_skill_breakdown(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await SkillScoringService(db).get_breakdown(current_user.id)


@router.get("/users/{user_id}/skills", response_model = list[SkillBreakdownItem])
async def get_learner_skill_breakdown(
    user_id: UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await SkillScoringService(db).get_breakdown(user_id)
