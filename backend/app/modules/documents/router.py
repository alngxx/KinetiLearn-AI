from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_db, require_admin
from app.modules.auth.models import User
from app.modules.documents.schemas import DocumentUploadResponse
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
