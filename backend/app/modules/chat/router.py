from uuid import UUID

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.modules.auth.models import User
from app.modules.chat.schemas import (
    ChatMessageResponse,
    ChatSessionResponse,
    ExplainRequest,
    MessageCreate,
    SessionCreate,
)
from app.modules.chat.service import ChatService

router = APIRouter()


@router.post(
    "/sessions",
    response_model = ChatSessionResponse,
    status_code = status.HTTP_201_CREATED,
)
async def create_session(
    # Optional body: no body at all opens a chat over the whole corpus.
    data: SessionCreate | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    document_id = data.document_id if data is not None else None
    return await ChatService(db).create_session(current_user.id, document_id)


# Backs the recent-chats sidebar: the caller's own general chats only.
@router.get("/sessions", response_model = list[ChatSessionResponse])
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ChatService(db).list_sessions(current_user.id)


# 404s for a session that is not the caller's, exactly as a missing one does.
@router.get(
    "/sessions/{session_id}/messages",
    response_model = list[ChatMessageResponse],
)
async def list_session_messages(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ChatService(db).list_messages(session_id, current_user.id)


def _sse_response(stream) -> StreamingResponse:
    return StreamingResponse(
        stream,
        media_type = "text/event-stream",
        headers = {
            "Cache-Control": "no-cache",
            # Stops nginx buffering the whole body and defeating the stream.
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/messages")
async def create_message(
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Awaited here so validation failures still come back as normal JSON errors —
    # once the stream starts the status code is already sent.
    stream = await ChatService(db).answer(current_user.id, data)
    return _sse_response(stream)


# Learner-facing: the service only ever loads the caller's own submission.
@router.post("/explain")
async def explain_submission(
    data: ExplainRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stream = await ChatService(db).explain_submission(current_user.id, data)
    return _sse_response(stream)
