import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import vectorstore
from app.core.llm import CHAT_MODEL, CHAT_SYSTEM_PROMPT, LLMError, embed_query, stream_chat
from app.modules.chat.models import ChatMessage, ChatMessageCitation, ChatSession
from app.modules.chat.schemas import ChatSessionResponse, CitationResponse, MessageCreate
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion

TOP_K = 5
HISTORY_LIMIT = 6
# Cosine similarity below this counts as "the corpus has nothing on this". Deliberately
# permissive: a short question against a 500-token chunk scores around 0.2-0.5 even
# when it matches well, so a stricter cutoff would reject real questions.
MIN_SIMILARITY = 0.25
TITLE_MAX_LENGTH = 60
NO_MATCH_ANSWER = (
    "I couldn't find anything about that in the training materials. "
    "Try rephrasing, or ask about a topic covered by the uploaded documents."
)


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


class ChatService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_session(self, user_id: UUID) -> ChatSessionResponse:
        session = ChatSession(user_id = user_id)
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        return ChatSessionResponse.model_validate(session)

    # Filtering on user_id inside the query means someone else's session is
    # indistinguishable from one that doesn't exist.
    async def _load_session(self, session_id: UUID, user_id: UUID) -> ChatSession:
        result = await self.db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.user_id == user_id,
            )
        )
        session = result.scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code = 404, detail = "Chat session not found.")
        return session

    # The (document, version) pairs a learner is allowed to see: a live document,
    # its promoted version, and only if that version finished processing.
    async def _active_scope(self) -> list[tuple[UUID, int]]:
        result = await self.db.execute(
            select(Document.id, Document.active_version_number)
            .join(
                DocumentVersion,
                (DocumentVersion.document_id == Document.id)
                & (DocumentVersion.version_number == Document.active_version_number),
            )
            .where(
                Document.is_active.is_(True),
                Document.active_version_number.isnot(None),
                DocumentVersion.processing_status == "ready",
            )
        )
        return [(row[0], row[1]) for row in result.all()]

    async def _retrieve(self, query: str) -> list[tuple[DocumentChunk, str, float]]:
        scope = await self._active_scope()
        if not scope:
            return []

        embedding = await embed_query(query)
        # Chroma's client is synchronous and the HNSW search is CPU-bound, so run it
        # off the event loop.
        hits = await asyncio.to_thread(vectorstore.search, embedding, scope, TOP_K)
        if not hits:
            return []

        vector_ids = [h["vector_id"] for h in hits]
        result = await self.db.execute(
            select(DocumentChunk, Document.title)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(DocumentChunk.vector_id.in_(vector_ids))
        )
        by_vector_id = {chunk.vector_id: (chunk, title) for chunk, title in result.all()}

        # Keep Chroma's ranking, and drop any vector without a Postgres row.
        retrieved = []
        for hit in hits:
            found = by_vector_id.get(hit["vector_id"])
            if found is not None:
                retrieved.append((found[0], found[1], hit["similarity"]))
        return retrieved

    async def _history(self, session_id: UUID) -> list[dict]:
        result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(HISTORY_LIMIT)
        )
        messages = list(result.scalars().all())
        messages.reverse()
        return [{"role": m.role, "content": m.content} for m in messages]

    def _build_prompt(
        self,
        question: str,
        retrieved: list[tuple[DocumentChunk, str, float]],
        history: list[dict],
    ) -> list[dict]:
        if retrieved:
            sources = "\n\n".join(
                f'[Source {i}] from "{title}", chunk {chunk.chunk_index}:\n{chunk.content}'
                for i, (chunk, title, _) in enumerate(retrieved, start = 1)
            )
            user_content = f"Source excerpts:\n{sources}\n\nQuestion: {question}"
        else:
            user_content = question

        return [
            {"role": "system", "content": CHAT_SYSTEM_PROMPT},
            *history,
            {"role": "user", "content": user_content},
        ]

    async def answer(self, user_id: UUID, data: MessageCreate) -> AsyncIterator[str]:
        # Everything that can raise runs here, before the response starts, so these
        # still reach the client as normal JSON errors rather than mid-stream events.
        session = await self._load_session(data.session_id, user_id)    # check auth, can throw 404
        history = await self._history(session.id)                       # take the last 6 messages
        try:
            retrieved = await self._retrieve(data.content)              # enbed + search Chroma + take the chunks
        except LLMError:
            raise HTTPException(status_code = 502, detail = "Failed to search the documents")

        best_similarity = retrieved[0][2] if retrieved else 0.0
        # A weak match only means "nothing to answer from" when there is no
        # conversation either. Mid-conversation, a follow-up like "explain the second
        # one" always embeds poorly, and the answer is usually already in history.
        if best_similarity < MIN_SIMILARITY:
            if not history:
                return self._canned_stream(session, data.content)
            retrieved = []

        return self._llm_stream(session, data.content, retrieved, history)

    async def _canned_stream(
        self, session: ChatSession, question: str
    ) -> AsyncIterator[str]:
        yield _sse("token", {"content": NO_MATCH_ANSWER})
        # No LLM call happened, so there is no model, token count or latency to record.
        message = await self._persist_turn(
            session, question, NO_MATCH_ANSWER, [], None, None, None
        )
        yield _sse("done", {
            "session_id": str(session.id),
            "message_id": str(message.id),
            "citations": [],
        })

    async def _llm_stream(
        self,
        session: ChatSession,
        question: str,
        retrieved: list[tuple[DocumentChunk, str, float]],
        history: list[dict],
    ) -> AsyncIterator[str]:
        messages = self._build_prompt(question, retrieved, history)
        usage: dict = {}
        parts = []
        started = time.monotonic()
        try:
            async for delta in stream_chat(messages, usage):
                parts.append(delta)
                yield _sse("token", {"content": delta})
        except LLMError:
            # Nothing has been written yet, but the retrieval reads opened a
            # transaction — drop it so the session is clean for the next request.
            await self.db.rollback()
            yield _sse("error", {"detail": "Failed to generate a response"})
            return

        latency_ms = int((time.monotonic() - started) * 1000)
        message = await self._persist_turn(
            session,
            question,
            "".join(parts),
            retrieved,
            CHAT_MODEL,
            usage.get("total_tokens"),
            latency_ms,
        )
        citations = [
            CitationResponse(
                document_chunk_id = chunk.id,
                document_id = chunk.document_id,
                document_title = title,
                chunk_index = chunk.chunk_index,
                relevance_score = similarity,
                content = chunk.content,
            ).model_dump(mode = "json")
            for chunk, title, similarity in retrieved
        ]
        yield _sse("done", {
            "session_id": str(session.id),
            "message_id": str(message.id),
            "citations": citations,
        })

    # The whole turn lands in one commit: a failure part-way through generation must
    # leave no trace, not a question with no answer.
    async def _persist_turn(
        self,
        session: ChatSession,
        question: str,
        answer: str,
        retrieved: list[tuple[DocumentChunk, str, float]],
        model_name: str | None,
        token_count: int | None,
        latency_ms: int | None,
    ) -> ChatMessage:
        # created_at is the only ordering the schema gives messages, and the column
        # default now() is the transaction timestamp — both rows of a turn commit
        # together and would share it. Set it explicitly so the answer sorts after
        # its question.
        asked_at = datetime.now(timezone.utc)
        self.db.add(ChatMessage(
            session_id = session.id,
            role = "user",
            content = question,
            created_at = asked_at,
        ))
        assistant = ChatMessage(
            session_id = session.id,
            role = "assistant",
            content = answer,
            token_count = token_count,
            model_name = model_name,
            latency_ms = latency_ms,
            created_at = asked_at + timedelta(milliseconds = 1),
        )
        self.db.add(assistant)
        await self.db.flush()

        for chunk, _, similarity in retrieved:
            self.db.add(ChatMessageCitation(
                chat_message_id = assistant.id,
                document_chunk_id = chunk.id,
                relevance_score = similarity,
            ))

        if session.title is None:
            session.title = question[:TITLE_MAX_LENGTH]
        # Adding messages doesn't touch the session row, so onupdate never fires and
        # the "recent chats" ordering would go stale without this.
        session.updated_at = datetime.now(timezone.utc)

        await self.db.commit()
        return assistant
