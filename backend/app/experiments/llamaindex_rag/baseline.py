import time

import tiktoken
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.llm import CHAT_MODEL, stream_chat
from app.experiments.llamaindex_rag.result import Citation, RagResult
from app.modules.chat.service import MIN_SIMILARITY, NO_MATCH_ANSWER, TOP_K, ChatService

# gpt-6-luna has no tiktoken entry; o200k_base is the closest public encoding,
# which is why the prompt/completion split is flagged as an estimate.
_encoding = tiktoken.get_encoding("o200k_base")


def estimate_prompt_tokens(messages: list[dict]) -> int:
    # About 3 tokens of chat framing per message, plus 3 for the reply primer.
    return sum(len(_encoding.encode(m["content"])) + 3 for m in messages) + 3


async def answer_current(
    db: AsyncSession,
    question: str,
    top_k: int = TOP_K,
    min_similarity: float = MIN_SIMILARITY,
) -> RagResult:
    """Answer one question through the production chat code, unmodified.

    Runs ChatService's own scope, retrieval and prompt building, then
    collects stream_chat. It skips _persist_turn, so nothing is written.
    The question is treated as the first turn of a session, with no history,
    over the whole visible corpus.
    """
    service = ChatService(db)
    started = time.monotonic()

    scope = await service._active_scope()
    retrieved = await service._retrieve(question, scope, top_k)
    citations = [
        Citation(
            document_id = str(chunk.document_id),
            document_title = title,
            chunk_index = chunk.chunk_index,
            relevance_score = similarity,
            content = chunk.content,
        )
        for chunk, title, similarity in retrieved
    ]

    # Same rule as ChatService.answer with an empty history.
    best_similarity = retrieved[0][2] if retrieved else 0.0
    if best_similarity < min_similarity:
        return RagResult(
            answer = NO_MATCH_ANSWER,
            citations = citations,
            no_match = True,
            latency_ms = int((time.monotonic() - started) * 1000),
        )

    messages = service._build_prompt(question, retrieved, [])
    usage: dict = {}
    parts = []
    async for delta in stream_chat(messages, usage):
        parts.append(delta)

    total_tokens = usage.get("total_tokens", 0)
    prompt_tokens = min(estimate_prompt_tokens(messages), total_tokens)
    return RagResult(
        answer = "".join(parts),
        citations = citations,
        prompt_tokens = prompt_tokens,
        completion_tokens = total_tokens - prompt_tokens,
        total_tokens = total_tokens,
        tokens_estimated = True,
        latency_ms = int((time.monotonic() - started) * 1000),
        model = CHAT_MODEL,
    )
