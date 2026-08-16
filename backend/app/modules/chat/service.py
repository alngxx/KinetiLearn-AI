import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import vectorstore
from app.core.llm import (
    CHAT_MODEL,
    CHAT_SYSTEM_PROMPT,
    EXPLAIN_SYSTEM_PROMPT,
    LLMError,
    embed_query,
    stream_chat,
)
from app.modules.chat.models import ChatMessage, ChatMessageCitation, ChatSession
from app.modules.chat.schemas import (
    ChatSessionResponse,
    CitationResponse,
    ExplainRequest,
    MessageCreate,
)
from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from app.modules.exams.models import (
    Exercise,
    ExerciseDocument,
    Question,
    QuestionOption,
)
from app.modules.submissions.models import Submission

TOP_K = 5
HISTORY_LIMIT = 10
# Cosine similarity below this counts as "the corpus has nothing on this". Deliberately
# permissive: a short question against a 500-token chunk scores around 0.2-0.5 even
# when it matches well, so a stricter cutoff would reject real questions.
MIN_SIMILARITY = 0.25
TITLE_MAX_LENGTH = 60
# Explaining wrong answers retrieves per question, so the caps are tighter than
# TOP_K: 10 questions x 3 chunks would otherwise blow past the context budget.
MAX_EXPLAIN_QUESTIONS = 10
EXPLAIN_TOP_K = 3
MAX_EXPLAIN_SOURCES = 8
NO_MATCH_ANSWER = (
    "I couldn't find anything about that in the training materials. "
    "Try rephrasing, or ask about a topic covered by the uploaded documents."
)


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


class ChatService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_session(
        self, user_id: UUID, document_id: UUID | None = None
    ) -> ChatSessionResponse:
        # A document the learner cannot see is rejected the same way as one that
        # doesn't exist, so the id can't be used to probe the corpus.
        if document_id is not None and not await self._active_scope(document_id):
            raise HTTPException(status_code = 404, detail = "Document not found.")

        session = ChatSession(user_id = user_id, document_id = document_id)
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
    # its promoted version, and only if that version finished processing. Passing
    # document_id narrows the result to that one document, or to nothing when it
    # isn't visible.
    async def _active_scope(
        self, document_id: UUID | None = None
    ) -> list[tuple[UUID, int]]:
        stmt = (
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
        if document_id is not None:
            stmt = stmt.where(Document.id == document_id)
        result = await self.db.execute(stmt)
        return [(row[0], row[1]) for row in result.all()]

    async def _retrieve(
        self,
        query: str,
        scope: list[tuple[UUID, int]],
        top_k: int = TOP_K,
    ) -> list[tuple[DocumentChunk, str, float]]:
        if not scope:
            return []

        embedding = await embed_query(query)
        # Chroma's client is synchronous and the HNSW search is CPU-bound, so run it
        # off the event loop.
        hits = await asyncio.to_thread(vectorstore.search, embedding, scope, top_k)
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
        system_prompt: str = CHAT_SYSTEM_PROMPT,
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
            {"role": "system", "content": system_prompt},
            *history,
            {"role": "user", "content": user_content},
        ]

    async def answer(self, user_id: UUID, data: MessageCreate) -> AsyncIterator[str]:
        # Everything that can raise runs here, before the response starts, so these
        # still reach the client as normal JSON errors rather than mid-stream events.
        session = await self._load_session(data.session_id, user_id)    # check auth, can throw 404
        history = await self._history(session.id)                       # take the last 10 messages
        # A scoped session only ever searches its own material.
        scope = await self._session_scope(session)
        try:
            retrieved = await self._retrieve(data.content, scope)       # enbed + search Chroma + take the chunks
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

    # Same discipline as answer(): everything that can raise runs before the
    # generator is returned, so failures come back as normal JSON.
    async def explain_submission(
        self, user_id: UUID, data: ExplainRequest
    ) -> AsyncIterator[str]:
        submission, exercise = await self._load_own_submission(
            data.submission_id, user_id
        )
        # is_correct is NULL for a skipped question, so "not true" rather than
        # "false" — the learner lost the points either way.
        wrong_ids = [a.question_id for a in submission.answers if a.is_correct is not True]
        if not wrong_ids:
            raise HTTPException(
                status_code = 400, detail = "This submission has no incorrect answers."
            )

        result = await self.db.execute(
            select(Question)
            .where(Question.id.in_(wrong_ids))
            .order_by(Question.order_index)
            .options(selectinload(Question.options))
        )
        all_wrong = list(result.scalars().all())
        questions = all_wrong[:MAX_EXPLAIN_QUESTIONS]

        # Scope comes from the exam, so it covers every source document whether the
        # exam was generated from one or ten.
        scope = await self._provenance_scope(exercise.id)
        try:
            retrieved = await self._retrieve_for_questions(questions, scope)
        except LLMError:
            raise HTTPException(status_code = 502, detail = "Failed to search the documents")

        selected = {a.question_id: a.selected_option_id for a in submission.answers}
        content = _build_explain_request(exercise, questions, selected, len(all_wrong))

        # Storing the exercise keeps follow-up questions on the same material —
        # they arrive with only a session_id and no way to re-derive the exam.
        session = ChatSession(user_id = user_id, exercise_id = exercise.id)
        self.db.add(session)
        # Flush, not commit: _persist_turn commits the session together with the
        # turn, so an LLM failure rolls back the empty session too.
        await self.db.flush()

        return self._llm_stream(session, content, retrieved, [], EXPLAIN_SYSTEM_PROMPT)

    # Filtering on user_id inside the query means another learner's submission is
    # indistinguishable from one that doesn't exist.
    async def _load_own_submission(
        self, submission_id: UUID, user_id: UUID
    ) -> tuple[Submission, Exercise]:
        result = await self.db.execute(
            select(Submission, Exercise)
            .join(Exercise, Exercise.id == Submission.exercise_id)
            .where(
                Submission.id == submission_id,
                Submission.user_id == user_id,
            )
            .options(selectinload(Submission.answers))
        )
        row = result.first()
        if row is None:
            raise HTTPException(status_code = 404, detail = "Submission not found.")
        return row[0], row[1]

    # Every (document, version) the exam was generated from — read from
    # exercise_documents, not from per-question provenance, which is null whenever
    # more than one document fed generation. These are the versions the learner was
    # graded against, so a newer one could contradict the answer that was marked
    # correct. A soft-deleted document is still excluded.
    async def _provenance_scope(self, exercise_id: UUID) -> list[tuple[UUID, int]]:
        result = await self.db.execute(
            select(ExerciseDocument.document_id, ExerciseDocument.version_number)
            .join(
                DocumentVersion,
                (DocumentVersion.document_id == ExerciseDocument.document_id)
                & (DocumentVersion.version_number == ExerciseDocument.version_number),
            )
            .join(Document, Document.id == ExerciseDocument.document_id)
            .where(
                ExerciseDocument.exercise_id == exercise_id,
                Document.is_active.is_(True),
                DocumentVersion.processing_status == "ready",
            )
        )
        return [(row[0], row[1]) for row in result.all()]

    # An exam-scoped session covers every source document of that exam; a
    # document-scoped one covers exactly that document; neither means the corpus.
    async def _session_scope(self, session: ChatSession) -> list[tuple[UUID, int]]:
        if session.exercise_id is not None:
            return await self._provenance_scope(session.exercise_id)
        return await self._active_scope(session.document_id)

    # One search per question, since a single embedding of ten stitched-together
    # questions matches nothing well. Duplicates keep their best similarity.
    async def _retrieve_for_questions(
        self, questions: list[Question], scope: list[tuple[UUID, int]]
    ) -> list[tuple[DocumentChunk, str, float]]:
        merged: dict[UUID, tuple[DocumentChunk, str, float]] = {}
        for question in questions:
            hits = await self._retrieve(question.question_text, scope, EXPLAIN_TOP_K)
            for chunk, title, similarity in hits:
                found = merged.get(chunk.id)
                if found is None or similarity > found[2]:
                    merged[chunk.id] = (chunk, title, similarity)

        ranked = sorted(merged.values(), key = lambda r: r[2], reverse = True)
        return ranked[:MAX_EXPLAIN_SOURCES]

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
        system_prompt: str = CHAT_SYSTEM_PROMPT,
    ) -> AsyncIterator[str]:
        messages = self._build_prompt(question, retrieved, history, system_prompt)
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


def _option_line(option: QuestionOption) -> str:
    return f"{option.option_label}. {option.option_text}"


# The learner's side of the turn. It is persisted as the user message, so a
# follow-up question in the same session still has the full breakdown in history.
def _build_explain_request(
    exercise: Exercise,
    questions: list[Question],
    selected: dict,
    wrong_total: int,
) -> str:
    parts = [
        f'I just took the exam "{exercise.title}" and got these questions wrong. '
        "Explain each one."
    ]

    for i, question in enumerate(questions, start = 1):
        options = sorted(question.options, key = lambda o: o.option_label)
        chosen = next(
            (o for o in options if o.id == selected.get(question.id)), None
        )
        correct = next((o for o in options if o.is_correct), None)

        lines = [
            f"Question {i}: {question.question_text}",
            "Options:",
            *[_option_line(o) for o in options],
            f"My answer: {_option_line(chosen) if chosen else '(not answered)'}",
        ]
        if correct is not None:
            lines.append(f"Correct answer: {_option_line(correct)}")
        if question.explanation:
            lines.append(f"Author's note: {question.explanation}")
        parts.append("\n".join(lines))

    # Truncation is never silent: the caveat is in the prompt the model sees and
    # in the message the learner's transcript keeps.
    if wrong_total > len(questions):
        parts.append(
            f"(I got {wrong_total} questions wrong; only the first {len(questions)} "
            "are listed here.)"
        )
    return "\n\n".join(parts)
