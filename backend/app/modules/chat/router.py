from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.modules.auth.models import User
from app.modules.chat.schemas import ChatSessionResponse, MessageCreate
from app.modules.chat.service import ChatService

router = APIRouter()


@router.post(
    "/sessions",
    response_model = ChatSessionResponse,
    status_code = status.HTTP_201_CREATED,
)
async def create_session(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ChatService(db).create_session(current_user.id)


@router.post("/messages")
async def create_message(
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Awaited here so validation failures still come back as normal JSON errors —
    # once the stream starts the status code is already sent.
    stream = await ChatService(db).answer(current_user.id, data)
    return StreamingResponse(
        stream,
        media_type = "text/event-stream",
        headers = {
            "Cache-Control": "no-cache",
            # Stops nginx buffering the whole body and defeating the stream.
            "X-Accel-Buffering": "no",
        },
    )
