import uuid
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import get_by_id
from app.core.storage import R2Storage, StorageError
from app.modules.config.models import Category
from app.modules.documents.models import Document, DocumentVersion
from app.modules.documents.schemas import DocumentUploadResponse

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

# Allowed upload types mapped to the file extension used in the R2 key.
MIME_EXT = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}


class DocumentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def upload(
        self,
        *,
        title: str,
        category_id: UUID,
        description: str | None,
        change_note: str | None,
        file: UploadFile,
        uploader_id: UUID,
    ) -> DocumentUploadResponse:
        # 1. Validate mime type — reject before touching R2 or the DB.
        if file.content_type not in MIME_EXT:
            raise HTTPException(
                status_code = 422,
                detail = "File must be a PDF or DOCX",
            )

        # 2. Read the file and validate size.
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code = 422,
                detail = "File exceeds the 20 MB limit",
            )

        # 3. Validate the category exists.
        category = await get_by_id(self.db, Category, category_id)
        if category is None:
            raise HTTPException(status_code = 422, detail = "Category not found")

        # 4. Find an existing document with the same title + category, and
        #    work out the target document id and next version number.
        result = await self.db.execute(
            select(Document).where(
                Document.title == title,
                Document.category_id == category_id,
            )
        )
        document = result.scalars().first()

        if document is None:
            document_id = uuid.uuid4()
            version_number = 1
            is_new_document = True
        else:
            document_id = document.id
            max_version = await self.db.execute(
                select(func.max(DocumentVersion.version_number)).where(
                    DocumentVersion.document_id == document_id
                )
            )
            version_number = max_version.scalar_one() + 1
            is_new_document = False

        ext = MIME_EXT[file.content_type]
        key = f"documents/{document_id}/v{version_number}.{ext}"

        # 5. Upload to R2 — only after all validation has passed.
        storage = R2Storage()
        try:
            storage.upload(key, content, file.content_type)
        except StorageError:
            raise HTTPException(
                status_code = 502,
                detail = "Failed to store the file",
            )

        # 6. Only after a successful R2 upload, write the DB rows. If the DB
        #    write fails, delete the just-uploaded object so we don't leave an
        #    orphaned file in R2 pointing to no record.
        try:
            if is_new_document:
                document = Document(
                    id = document_id,
                    title = title,
                    description = description,
                    category_id = category_id,
                    created_by = uploader_id,
                )
                self.db.add(document)

            version = DocumentVersion(
                document_id = document_id,
                version_number = version_number,
                file_url = key,
                file_name = file.filename,
                file_size_bytes = len(content),
                mime_type = file.content_type,
                change_note = change_note,
                uploaded_by = uploader_id,
            )
            self.db.add(version)
            await self.db.commit()
            await self.db.refresh(version)
        except SQLAlchemyError:
            await self.db.rollback()
            try:
                storage.delete(key)
            except StorageError:
                pass  # best-effort cleanup; the DB error is what matters
            raise HTTPException(
                status_code = 500,
                detail = "Failed to save the document record",
            )

        return DocumentUploadResponse(
            document_id = version.document_id,
            version_number = version.version_number,
            title = title,
            file_name = version.file_name,
            mime_type = version.mime_type,
            file_size_bytes = version.file_size_bytes,
            processing_status = version.processing_status,
            created_at = version.created_at,
        )
