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
