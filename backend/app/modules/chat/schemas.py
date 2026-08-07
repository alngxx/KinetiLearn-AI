from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Body is optional on POST /sessions — omitting it opens an unscoped chat.
class SessionCreate(BaseModel):
    document_id: UUID | None = None


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    document_id: UUID | None
    title: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class MessageCreate(BaseModel):
    session_id: UUID
    content: str = Field(..., min_length = 1, max_length = 4000)


class ExplainRequest(BaseModel):
    submission_id: UUID


# Sent inside the terminal "done" SSE event, not used as a response_model.
class CitationResponse(BaseModel):
    document_chunk_id: UUID
    document_id: UUID
    document_title: str
    chunk_index: int
    relevance_score: float
    content: str
