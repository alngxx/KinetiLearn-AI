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


# Document-level view returned by activate/deactivate, promote, and skill tagging.
class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    document_id: UUID
    title: str
    category_id: UUID | None
    active_version_number: int | None
    is_active: bool
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
