from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_admin
from app.modules.auth.models import User
from app.modules.classes.schemas import (
    BulkAddMembersRequest,
    BulkAddMembersResponse,
    ClassCreate,
    ClassDetailResponse,
    ClassResponse,
    ClassUpdate,
    LearnerExerciseSummary,
    MyClassResponse,
)
from app.modules.classes.service import ClassService

router = APIRouter(dependencies = [Depends(require_admin)])

# The admin router applies require_admin to every route, so the learner-facing
# reads live on their own router — same split as the daily quiz module. It must be
# mounted before the admin one so /classes/me isn't matched as /classes/{class_id}.
my_classes_router = APIRouter(prefix = "/classes", tags = ["Classes — Learner"])


@my_classes_router.get("/me", response_model = list[MyClassResponse])
async def list_my_classes(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ClassService(db).get_my(current_user.id)


@my_classes_router.get(
    "/{class_id}/exercises", response_model = list[LearnerExerciseSummary]
)
async def list_my_class_exercises(
    class_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ClassService(db).get_my_exercises(class_id, current_user.id)


@router.post("", response_model = ClassResponse, status_code = status.HTTP_201_CREATED)
async def create_class(
    data: ClassCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await ClassService(db).create(data, current_user.id)


@router.get("", response_model = list[ClassResponse])
async def list_classes(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
):
    return await ClassService(db).get_all(include_inactive)


@router.get("/{class_id}", response_model = ClassDetailResponse)
async def get_class(class_id: UUID, db: AsyncSession = Depends(get_db)):
    return await ClassService(db).get_by_id(class_id)


@router.put("/{class_id}", response_model = ClassResponse)
async def update_class(
    class_id: UUID, data: ClassUpdate, db: AsyncSession = Depends(get_db)
):
    return await ClassService(db).update(class_id, data)


@router.patch("/{class_id}/activate", response_model = ClassResponse)
async def activate_class(class_id: UUID, db: AsyncSession = Depends(get_db)):
    return await ClassService(db).activate(class_id)


@router.patch("/{class_id}/deactivate", response_model = ClassResponse)
async def deactivate_class(class_id: UUID, db: AsyncSession = Depends(get_db)):
    return await ClassService(db).deactivate(class_id)


@router.post("/{class_id}/members/bulk", response_model = BulkAddMembersResponse)
async def bulk_add_members(
    class_id: UUID,
    data: BulkAddMembersRequest,
    db: AsyncSession = Depends(get_db),
):
    return await ClassService(db).bulk_add_members(class_id, data)
