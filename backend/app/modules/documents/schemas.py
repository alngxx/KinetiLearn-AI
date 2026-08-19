from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


# Response for POST /documents/upload. Combines fields from the Document
# (title) and the newly created DocumentVersion.
class DocumentUploadResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    document_id: UUID
    version_number: int
    title: str
    file_name: str
    mime_type: str
    file_size_bytes: int
    processing_status: str
    created_at: datetime


# Document-level view returned by activate/deactivate, promote, skill tagging,
# and the document list.
class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    document_id: UUID
    title: str
    category_id: UUID | None
    active_version_number: int | None
    is_active: bool
    active_version_processing_status: str | None
    skill_ids: list[UUID]
    created_at: datetime


# Version-level view returned by promote and reprocess.
class DocumentVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    document_id: UUID
    version_number: int
    processing_status: str
    file_name: str
    created_at: datetime


# Per-version detail for the document detail view — every version, not just
# the active one.
class DocumentVersionDetail(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    version_number: int
    file_name: str
    file_size_bytes: int
    mime_type: str
    processing_status: str
    processing_error: str | None
    change_note: str | None
    created_at: datetime


# Full detail returned by GET /documents/{id}.
class DocumentDetailResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    document_id: UUID
    title: str
    description: str | None
    category_id: UUID | None
    active_version_number: int | None
    is_active: bool
    skill_ids: list[UUID]
    versions: list[DocumentVersionDetail]
    created_at: datetime
