from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_admin
from app.modules.auth.models import User
from app.modules.documents.schemas import (
    DocumentResponse,
    DocumentUploadResponse,
    DocumentVersionResponse,
)
from app.modules.documents.service import DocumentService

router = APIRouter()


@router.post(
    "/upload",
    response_model = DocumentUploadResponse,
    status_code = status.HTTP_201_CREATED,
)
async def upload_document(
    title: str = Form(..., min_length = 1, max_length = 255),
    category_id: UUID = Form(...),
    description: str | None = Form(None),
    change_note: str | None = Form(None),
    file: UploadFile = File(...),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    return await DocumentService(db).upload(
        title = title,
        category_id = category_id,
        description = description,
        change_note = change_note,
        file = file,
        uploader_id = current_user.id,
    )


@router.patch(
    "/{document_id}/versions/{version_number}/promote",
    response_model = DocumentResponse,
    dependencies = [Depends(require_admin)],
)
async def promote_version(
    document_id: UUID,
    version_number: int,
    db: AsyncSession = Depends(get_db),
):
    return await DocumentService(db).promote_version(document_id, version_number)


@router.patch(
    "/{document_id}/activate",
    response_model = DocumentResponse,
    dependencies = [Depends(require_admin)],
)
async def activate_document(document_id: UUID, db: AsyncSession = Depends(get_db)):
    return await DocumentService(db).activate(document_id)


@router.patch(
    "/{document_id}/deactivate",
    response_model = DocumentResponse,
    dependencies = [Depends(require_admin)],
)
async def deactivate_document(document_id: UUID, db: AsyncSession = Depends(get_db)):
    return await DocumentService(db).deactivate(document_id)


@router.post(
    "/{document_id}/skills/{skill_id}",
    response_model = DocumentResponse,
    dependencies = [Depends(require_admin)],
)
async def attach_skill(
    document_id: UUID,
    skill_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await DocumentService(db).attach_skill(document_id, skill_id)


@router.delete(
    "/{document_id}/skills/{skill_id}",
    response_model = DocumentResponse,
    dependencies = [Depends(require_admin)],
)
async def detach_skill(
    document_id: UUID,
    skill_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    return await DocumentService(db).detach_skill(document_id, skill_id)


@router.post(
    "/{document_id}/versions/{version_number}/reprocess",
    response_model = DocumentVersionResponse,
    dependencies = [Depends(require_admin)],
)
async def reprocess_version(
    document_id: UUID,
    version_number: int,
    db: AsyncSession = Depends(get_db),
):
    return await DocumentService(db).reprocess_version(document_id, version_number)
