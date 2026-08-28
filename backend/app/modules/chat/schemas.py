from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# Body is optional on POST /sessions — omitting it opens an unscoped chat.
class SessionCreate(BaseModel):
    document_id: UUID | None = None


class ChatSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes = True)

    id: UUID
    exercise_id: UUID | None
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


# Sent inside the terminal "done" SSE event, and reused as the citation shape on
# a stored message so a reloaded answer looks identical to one just streamed.
class CitationResponse(BaseModel):
    document_chunk_id: UUID
    document_id: UUID
    document_title: str
    chunk_index: int
    relevance_score: float
    content: str


class ChatMessageResponse(BaseModel):
    id: UUID
    # Literal rather than str so the generated TypeScript is a union the
    # frontend's own ChatMessage role can be assigned from.
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    citations: list[CitationResponse]
