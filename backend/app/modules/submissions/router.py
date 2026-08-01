from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_admin
from app.modules.auth.models import User
from app.modules.submissions.schemas import (
    ScoreUpdate,
    SubmissionDetailResponse,
    SubmissionResponse,
    SubmitRequest,
)
from app.modules.submissions.service import SubmissionService

router = APIRouter()


@router.post(
    "",
    response_model = SubmissionDetailResponse,
    status_code = status.HTTP_201_CREATED,
)
async def submit(
    data: SubmitRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await SubmissionService(db).submit(current_user.id, data)


# Declared before /{submission_id} so "me" is not parsed as a UUID path param.
@router.get("/me", response_model = list[SubmissionResponse])
async def get_my_submissions(
    class_id: UUID | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await SubmissionService(db).get_my(current_user.id, class_id)


@router.get("", response_model = list[SubmissionResponse])
async def list_submissions(
    class_id: UUID | None = None,
    user_id: UUID | None = None,
    exercise_id: UUID | None = None,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await SubmissionService(db).list_for_admin(class_id, user_id, exercise_id)


@router.get("/{submission_id}", response_model = SubmissionDetailResponse)
async def get_submission(
    submission_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await SubmissionService(db).get_detail(submission_id, current_user)


@router.patch("/{submission_id}", response_model = SubmissionResponse)
async def update_submission_score(
    submission_id: UUID,
    data: ScoreUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await SubmissionService(db).update_score(submission_id, data)
