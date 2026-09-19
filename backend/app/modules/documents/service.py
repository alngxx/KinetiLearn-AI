import asyncio
import logging
import uuid
from uuid import UUID

from fastapi import HTTPException, UploadFile
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy import update as sa_update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import vectorstore
from app.core.crud import assert_no_dependents, get_by_id, get_or_404
from app.core.llm import LLMError, suggest_skills
from app.core.storage import R2Storage, StorageError
from app.modules.chat.models import ChatSession
from app.modules.config.models import Category, Skill
from app.modules.classes.models import Class
from app.modules.documents.models import (
    ClassDocument,
    Document,
    DocumentChunk,
    DocumentSkill,
    DocumentVersion,
)
from app.modules.documents.schemas import (
    DocumentDeleteResponse,
    DocumentDetailResponse,
    DocumentResponse,
    DocumentUpdate,
    DocumentUploadResponse,
    DocumentVersionDetail,
    SkillSuggestionResponse,
    DocumentVersionResponse,
)
from app.modules.exams.models import ExerciseDocument
from app.modules.quiz.models import DailyQuizConfig

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

# Chunks fed to the skill-suggestion prompt. The ingestion pipeline targets 500
# tokens per chunk, so this is roughly a 6k-token prompt — classifying a
# document against a handful of skill names needs far less context than writing
# questions from it, and this constant is the cost lever for that endpoint.
MAX_SUGGEST_CHUNKS = 12

# Allowed upload types mapped to the file extension used in the R2 key.
MIME_EXT = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "text/markdown": "md",
}


class DocumentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def upload(
        self,
        *,
        title: str,
        category_id: UUID,
        class_ids: list[UUID],
        description: str | None,
        change_note: str | None,
        file: UploadFile,
        uploader_id: UUID,
    ) -> DocumentUploadResponse:
        # 1. Validate mime type — reject before touching R2 or the DB. Browsers
        #    report .md inconsistently (text/markdown, text/plain,
        #    application/octet-stream, or empty), so a .md filename is trusted
        #    over whatever content_type it arrived with; PDF and DOCX still go
        #    by content_type alone.
        content_type: str = (
            "text/markdown"
            if file.filename is not None and file.filename.lower().endswith(".md")
            else file.content_type or ""
        )
        if content_type not in MIME_EXT:
            raise HTTPException(
                status_code = 422,
                detail = "File must be a PDF, DOCX, or Markdown file",
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

        # 3b. Every class has to exist. Same 422 as the category check above,
        #     and same silence about is_active.
        wanted_class_ids = await self._validated_class_ids(class_ids)

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

        ext = MIME_EXT[content_type]
        key = f"documents/{document_id}/v{version_number}.{ext}"

        # 5. Upload to R2 — only after all validation has passed.
        storage = R2Storage()
        try:
            storage.upload(key, content, content_type)
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
                mime_type = content_type,
                change_note = change_note,
                uploaded_by = uploader_id,
            )
            self.db.add(version)

            # Union rather than replace. A re-upload is a new version of a
            # document already in use, so dropping the classes it was serving
            # would pull it out of their pickers as a side effect of an upload.
            linked = set() if is_new_document else await self._linked_class_ids(document_id)
            for class_id in wanted_class_ids:
                if class_id not in linked:
                    self.db.add(
                        ClassDocument(class_id = class_id, document_id = document_id)
                    )

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

    async def _validated_class_ids(self, class_ids: list[UUID]) -> list[UUID]:
        # Dedupe while preserving order, the same way exam generation treats its
        # document_ids.
        unique_ids = list(dict.fromkeys(class_ids))
        if not unique_ids:
            raise HTTPException(
                status_code = 422, detail = "At least one class is required"
            )
        result = await self.db.execute(
            select(Class.id).where(Class.id.in_(unique_ids))
        )
        found = set(result.scalars().all())
        missing = [str(class_id) for class_id in unique_ids if class_id not in found]
        if missing:
            raise HTTPException(
                status_code = 422,
                detail = f"Class not found: {', '.join(missing)}",
            )
        return unique_ids

    async def _validated_skill_ids(
        self, document: Document, skill_ids: list[UUID]
    ) -> list[UUID]:
        # skills.category_id is NOT NULL, so a skill only means anything inside
        # its category — and an uncategorized document has no valid skill list
        # at all. Checked before the membership test below so an uncategorized
        # document gets the actionable message rather than a list of names.
        if document.category_id is None:
            raise HTTPException(
                status_code = 422,
                detail = "Set a category on this document before assigning skills",
            )

        unique_ids = list(dict.fromkeys(skill_ids))
        if not unique_ids:
            return []

        result = await self.db.execute(
            select(Skill).where(Skill.id.in_(unique_ids))
        )
        found = {skill.id: skill for skill in result.scalars().all()}

        missing = [str(skill_id) for skill_id in unique_ids if skill_id not in found]
        if missing:
            raise HTTPException(
                status_code = 422,
                detail = f"Skill not found: {', '.join(missing)}",
            )

        # Named rather than listed by id: the admin picked these by name.
        outside = [
            found[skill_id].name
            for skill_id in unique_ids
            if found[skill_id].category_id != document.category_id
        ]
        if outside:
            raise HTTPException(
                status_code = 422,
                detail = (
                    "These skills do not belong to this document's category: "
                    f"{', '.join(outside)}"
                ),
            )
        return unique_ids

    async def _linked_skill_ids(self, document_id: UUID) -> set[UUID]:
        result = await self.db.execute(
            select(DocumentSkill.skill_id).where(
                DocumentSkill.document_id == document_id
            )
        )
        return set(result.scalars().all())

    async def _linked_class_ids(self, document_id: UUID) -> set[UUID]:
        result = await self.db.execute(
            select(ClassDocument.class_id).where(
                ClassDocument.document_id == document_id
            )
        )
        return set(result.scalars().all())

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
            class_ids = sorted(await self._linked_class_ids(document_id)),
            created_at = document.created_at,
        )

    async def get_all(
        self,
        category_id: UUID | None = None,
        include_inactive: bool = False,
        class_id: UUID | None = None,
    ) -> list[DocumentResponse]:
        stmt = select(Document)
        if category_id is not None:
            stmt = stmt.where(Document.category_id == category_id)
        # What the exam-generation source picker calls: only the documents
        # assigned to the class the exam is being generated for.
        if class_id is not None:
            stmt = stmt.join(
                ClassDocument, ClassDocument.document_id == Document.id
            ).where(ClassDocument.class_id == class_id)
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

        class_result = await self.db.execute(
            select(ClassDocument.document_id, ClassDocument.class_id).where(
                ClassDocument.document_id.in_(document_ids)
            )
        )
        class_ids_by_document: dict[UUID, list[UUID]] = {}
        for doc_id, linked_class_id in class_result.all():
            class_ids_by_document.setdefault(doc_id, []).append(linked_class_id)

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
                class_ids = sorted(class_ids_by_document.get(document.id, [])),
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
            class_ids = sorted(await self._linked_class_ids(document_id)),
            versions = versions,
            created_at = document.created_at,
        )

    async def update(
        self, document_id: UUID, data: DocumentUpdate
    ) -> DocumentDetailResponse:
        document = await get_or_404(
            self.db, Document, document_id, "Document not found"
        )
        update_data = data.model_dump(exclude_none = True)
        # Not columns, so they cannot ride the setattr loop at the end.
        new_class_ids = update_data.pop("class_ids", None)
        new_skill_ids = update_data.pop("skill_ids", None)

        # Same rule upload applies: the category has to exist. upload does not
        # check is_active either, so this deliberately doesn't.
        new_category_id = update_data.get("category_id")
        if new_category_id is not None:
            category = await get_by_id(self.db, Category, new_category_id)
            if category is None:
                raise HTTPException(status_code = 422, detail = "Category not found")

        # upload versions into whichever document already holds a given
        # title + category pair, so letting two documents share one would make
        # that lookup pick arbitrarily.
        title = update_data.get("title", document.title)
        category_id = update_data.get("category_id", document.category_id)
        if title != document.title or category_id != document.category_id:
            result = await self.db.execute(
                select(Document.id).where(
                    Document.title == title,
                    Document.category_id == category_id,
                    Document.id != document_id,
                )
            )
            if result.scalars().first() is not None:
                raise HTTPException(
                    status_code = 409,
                    detail = "Another document already uses this title in this category",
                )

        # Unlike upload, this replaces the set — reassigning is the whole point
        # of the action, so a class left out here is a class being removed.
        if new_class_ids is not None:
            wanted = set(await self._validated_class_ids(new_class_ids))
            linked = await self._linked_class_ids(document_id)
            if removed := linked - wanted:
                await self.db.execute(
                    sa_delete(ClassDocument).where(
                        ClassDocument.document_id == document_id,
                        ClassDocument.class_id.in_(removed),
                    )
                )
            for class_id in wanted - linked:
                self.db.add(
                    ClassDocument(class_id = class_id, document_id = document_id)
                )

        # Replaces the set, like class_ids — a skill left out is a skill being
        # removed. Validated against the document's category *after* the
        # category change above is staged, so moving a document and retagging it
        # in one request is checked against the category it ends up in.
        if new_skill_ids is not None:
            if new_category_id is not None:
                document.category_id = new_category_id
            wanted = set(await self._validated_skill_ids(document, new_skill_ids))
            linked = await self._linked_skill_ids(document_id)
            if removed := linked - wanted:
                await self.db.execute(
                    sa_delete(DocumentSkill).where(
                        DocumentSkill.document_id == document_id,
                        DocumentSkill.skill_id.in_(removed),
                    )
                )
            for skill_id in wanted - linked:
                self.db.add(
                    DocumentSkill(document_id = document_id, skill_id = skill_id)
                )

        for key, value in update_data.items():
            setattr(document, key, value)
        await self.db.commit()
        return await self.get_detail(document_id)

    async def delete(self, document_id: UUID) -> DocumentDeleteResponse:
        await get_or_404(self.db, Document, document_id, "Document not found")

        # exercise_documents cascades rather than restricting, so the DB would
        # let this through and silently drop the exam's only link back to its
        # source material. The other is a real RESTRICT FK that would otherwise
        # surface as a 500. chat_message_citations used to be a third check here,
        # but its FK now cascades — a cited document deletes cleanly and the old
        # answer just loses its source chip (see _stored_citations).
        await assert_no_dependents(
            self.db,
            select(ExerciseDocument.exercise_id).where(
                ExerciseDocument.document_id == document_id
            ),
            "Cannot delete a document used by an exam. Delete the exam first.",
        )
        await assert_no_dependents(
            self.db,
            select(DailyQuizConfig.id).where(
                DailyQuizConfig.source_document_id == document_id
            ),
            "Cannot delete a document used by a daily quiz config. "
            "Delete the config first.",
        )

        # Read before the delete — the cascade takes the version rows with it.
        result = await self.db.execute(
            select(DocumentVersion.file_url).where(
                DocumentVersion.document_id == document_id
            )
        )
        keys = list(result.scalars().all())

        # chat_sessions.document_id is ON DELETE SET NULL, and a session with
        # neither a document nor an exercise means the whole corpus — so a
        # scoped session would silently widen instead of ending. Closed in the
        # same transaction as the delete, on one commit, so a failure can never
        # leave sessions closed while the document is still there.
        await self.db.execute(
            sa_update(ChatSession)
            .where(ChatSession.document_id == document_id)
            .values(is_active = False)
        )
        await self.db.execute(sa_delete(Document).where(Document.id == document_id))
        await self.db.commit()

        # Only once the DB row is gone, which is what makes the document stop
        # existing. Both cleanups are best-effort: whatever they leave behind is
        # unreachable rather than wrong, since every chat scope is built from
        # document rows that no longer exist. A failure is reported, not raised.
        warnings = []
        try:
            await asyncio.to_thread(vectorstore.delete_document, document_id)
        except Exception:
            logger.exception("Failed to delete vectors for document %s", document_id)
            warnings.append("vector cleanup failed")

        try:
            storage = R2Storage()
            for key in keys:
                storage.delete(key)
        except StorageError:
            logger.exception("Failed to delete files for document %s", document_id)
            warnings.append("file cleanup failed")

        return DocumentDeleteResponse(
            deleted = 1,
            versions_deleted = len(keys),
            cleanup_warning = "; ".join(warnings) or None,
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

    async def suggest_skills(self, document_id: UUID) -> SkillSuggestionResponse:
        document = await get_or_404(
            self.db, Document, document_id, "Document not found"
        )
        # Same rule, same words as assigning: with no category there is no valid
        # skill list to suggest from.
        if document.category_id is None:
            raise HTTPException(
                status_code = 422,
                detail = "Set a category on this document before assigning skills",
            )
        category = await get_or_404(
            self.db, Category, document.category_id, "Category not found"
        )

        result = await self.db.execute(
            select(Skill)
            .where(Skill.category_id == document.category_id, Skill.is_active.is_(True))
            .order_by(Skill.name)
        )
        skills = list(result.scalars().all())
        if not skills:
            # Nothing to choose from, so there is nothing to ask the model.
            return SkillSuggestionResponse(
                skill_ids = [], prompt_tokens = 0, completion_tokens = 0, total_tokens = 0
            )

        excerpt = await self._suggestion_excerpt(document)
        if excerpt == "":
            raise HTTPException(
                status_code = 422,
                detail = "This document has no processed content to read yet",
            )

        try:
            names, tokens = await suggest_skills(
                category_name = category.name,
                document_title = document.title,
                excerpt = excerpt,
                skill_names = [skill.name for skill in skills],
            )
        except LLMError:
            logger.exception("Skill suggestion failed for document %s", document_id)
            raise HTTPException(
                status_code = 502, detail = "Could not generate a suggestion"
            )

        # The model is not trusted: anything that is not an exact (case- and
        # whitespace-insensitive) match on a name we sent is dropped rather than
        # guessed at. Iterating the skills rather than the response also dedupes
        # and keeps the order stable.
        wanted = {name.strip().casefold() for name in names}
        skill_ids = [
            skill.id for skill in skills if skill.name.strip().casefold() in wanted
        ]
        return SkillSuggestionResponse(skill_ids = skill_ids, **tokens)

    async def _suggestion_excerpt(self, document: Document) -> str:
        # Reuses the text the ingestion pipeline already extracted — the file is
        # never re-parsed, and R2 is never touched.
        if document.active_version_number is None:
            return ""
        result = await self.db.execute(
            select(DocumentChunk.content)
            .where(
                DocumentChunk.document_id == document.id,
                DocumentChunk.version_number == document.active_version_number,
            )
            .order_by(DocumentChunk.chunk_index)
            .limit(MAX_SUGGEST_CHUNKS)
        )
        return "\n\n".join(result.scalars().all())

    async def attach_skill(
        self, document_id: UUID, skill_id: UUID
    ) -> DocumentResponse:
        document = await get_or_404(
            self.db, Document, document_id, "Document not found"
        )
        await get_or_404(self.db, Skill, skill_id, "Skill not found")
        # Same invariant the bulk update enforces — otherwise this endpoint is a
        # way around it.
        await self._validated_skill_ids(document, [skill_id])
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
