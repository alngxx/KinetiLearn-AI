import logging
import uuid
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crud import get_by_id, get_or_404
from app.core.storage import R2Storage, StorageError
from app.modules.config.models import Category, Skill
from app.modules.documents.models import Document, DocumentSkill, DocumentVersion
from app.modules.documents.schemas import (
    DocumentDetailResponse,
    DocumentResponse,
    DocumentUploadResponse,
    DocumentVersionDetail,
    DocumentVersionResponse,
)

logger = logging.getLogger(__name__)

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

        # Only after the DB write is committed do we hand the version off to the
        # async pipeline — so a broker outage never triggers the R2 rollback above.
        self._enqueue_processing(version.document_id, version.version_number)

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

    def _enqueue_processing(self, document_id: UUID, version_number: int) -> None:
        # Local import so the web app doesn't pull Celery/Chroma/OpenAI at startup
        # and to avoid an import cycle with the worker package.
        from worker.tasks import process_document

        try:
            process_document.delay(str(document_id), version_number)
        except Exception:
            # The version row and R2 object are already persisted, so a broker
            # failure must not fail the request. The version stays "pending" and
            # can be re-triggered via reprocess_version.
            logger.exception(
                "Failed to enqueue processing for %s v%s", document_id, version_number
            )

    async def _get_version_or_404(
        self, document_id: UUID, version_number: int
    ) -> DocumentVersion:
        version = await self.db.get(DocumentVersion, (document_id, version_number))
        if version is None:
            raise HTTPException(status_code = 404, detail = "Document version not found")
        return version

    async def _active_version_status(
        self, document_id: UUID, active_version_number: int | None
    ) -> str | None:
        if active_version_number is not None:
            version = await self.db.get(
                DocumentVersion, (document_id, active_version_number)
            )
            return version.processing_status if version else None
        result = await self.db.execute(
            select(DocumentVersion.processing_status)
            .where(DocumentVersion.document_id == document_id)
            .order_by(DocumentVersion.version_number.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _document_response(self, document_id: UUID) -> DocumentResponse:
        document = await get_or_404(self.db, Document, document_id, "Document not found")
        result = await self.db.execute(
            select(DocumentSkill.skill_id).where(
                DocumentSkill.document_id == document_id
            )
        )
        status = await self._active_version_status(
            document_id, document.active_version_number
        )
        return DocumentResponse(
            document_id = document.id,
            title = document.title,
            category_id = document.category_id,
            active_version_number = document.active_version_number,
            is_active = document.is_active,
            active_version_processing_status = status,
            skill_ids = list(result.scalars().all()),
            created_at = document.created_at,
        )

    async def get_all(
        self,
        category_id: UUID | None = None,
        include_inactive: bool = False,
    ) -> list[DocumentResponse]:
        stmt = select(Document)
        if category_id is not None:
            stmt = stmt.where(Document.category_id == category_id)
        if not include_inactive:
            stmt = stmt.where(Document.is_active.is_(True))
        stmt = stmt.order_by(Document.created_at.desc())
        result = await self.db.execute(stmt)
        documents = list(result.scalars().all())
        if not documents:
            return []

        document_ids = [document.id for document in documents]

        skill_result = await self.db.execute(
            select(DocumentSkill.document_id, DocumentSkill.skill_id).where(
                DocumentSkill.document_id.in_(document_ids)
            )
        )
        skill_ids_by_document: dict[UUID, list[UUID]] = {}
        for doc_id, skill_id in skill_result.all():
            skill_ids_by_document.setdefault(doc_id, []).append(skill_id)

        version_result = await self.db.execute(
            select(
                DocumentVersion.document_id,
                DocumentVersion.version_number,
                DocumentVersion.processing_status,
            ).where(DocumentVersion.document_id.in_(document_ids))
        )
        versions_by_document: dict[UUID, dict[int, str]] = {}
        for doc_id, version_number, status in version_result.all():
            versions_by_document.setdefault(doc_id, {})[version_number] = status

        def active_status(document: Document) -> str | None:
            versions = versions_by_document.get(document.id)
            if not versions:
                return None
            if document.active_version_number is not None:
                return versions.get(document.active_version_number)
            return versions[max(versions)]

        return [
            DocumentResponse(
                document_id = document.id,
                title = document.title,
                category_id = document.category_id,
                active_version_number = document.active_version_number,
                is_active = document.is_active,
                active_version_processing_status = active_status(document),
                skill_ids = skill_ids_by_document.get(document.id, []),
                created_at = document.created_at,
            )
            for document in documents
        ]

    async def get_detail(self, document_id: UUID) -> DocumentDetailResponse:
        document = await get_or_404(self.db, Document, document_id, "Document not found")

        version_result = await self.db.execute(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == document_id)
            .order_by(DocumentVersion.version_number.desc())
        )
        versions = [
            DocumentVersionDetail.model_validate(version)
            for version in version_result.scalars().all()
        ]

        skill_result = await self.db.execute(
            select(DocumentSkill.skill_id).where(
                DocumentSkill.document_id == document_id
            )
        )

        return DocumentDetailResponse(
            document_id = document.id,
            title = document.title,
            description = document.description,
            category_id = document.category_id,
            active_version_number = document.active_version_number,
            is_active = document.is_active,
            skill_ids = list(skill_result.scalars().all()),
            versions = versions,
            created_at = document.created_at,
        )

    async def promote_version(
        self, document_id: UUID, version_number: int
    ) -> DocumentResponse:
        version = await self._get_version_or_404(document_id, version_number)
        if version.processing_status != "ready":
            raise HTTPException(
                status_code = 409,
                detail = "Version is not ready to be activated",
            )
        document = await get_or_404(self.db, Document, document_id, "Document not found")
        document.active_version_number = version_number
        await self.db.commit()
        return await self._document_response(document_id)

    async def activate(self, document_id: UUID) -> DocumentResponse:
        document = await get_or_404(self.db, Document, document_id, "Document not found")
        document.is_active = True
        await self.db.commit()
        return await self._document_response(document_id)

    async def deactivate(self, document_id: UUID) -> DocumentResponse:
        document = await get_or_404(self.db, Document, document_id, "Document not found")
        document.is_active = False
        await self.db.commit()
        return await self._document_response(document_id)

    async def attach_skill(
        self, document_id: UUID, skill_id: UUID
    ) -> DocumentResponse:
        await get_or_404(self.db, Document, document_id, "Document not found")
        await get_or_404(self.db, Skill, skill_id, "Skill not found")
        existing = await self.db.get(DocumentSkill, (document_id, skill_id))
        if existing is None:
            self.db.add(DocumentSkill(document_id = document_id, skill_id = skill_id))
            await self.db.commit()
        return await self._document_response(document_id)

    async def detach_skill(
        self, document_id: UUID, skill_id: UUID
    ) -> DocumentResponse:
        await get_or_404(self.db, Document, document_id, "Document not found")
        existing = await self.db.get(DocumentSkill, (document_id, skill_id))
        if existing is not None:
            await self.db.delete(existing)
            await self.db.commit()
        return await self._document_response(document_id)

    async def reprocess_version(
        self, document_id: UUID, version_number: int
    ) -> DocumentVersionResponse:
        version = await self._get_version_or_404(document_id, version_number)
        if version.processing_status == "processing":
            raise HTTPException(
                status_code = 409,
                detail = "Version is already being processed",
            )
        version.processing_status = "pending"
        version.processing_error = None
        await self.db.commit()
        await self.db.refresh(version)
        self._enqueue_processing(document_id, version_number)
        return DocumentVersionResponse.model_validate(version)
