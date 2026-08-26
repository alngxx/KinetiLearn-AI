from typing import AsyncIterator, Callable

from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel

from app.core.config import settings

CHAT_MODEL = "gpt-4o"
# Same model the worker embeds chunks with — queries must land in the same vector
# space. Repeated rather than imported from worker.processing, which builds a sync
# OpenAI client at import time and pulls in the whole PDF/DOCX toolchain.
EMBED_MODEL = "text-embedding-3-small"

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    # Lazy so importing this module doesn't build a client at import time
    # (keeps OpenAI out of app startup and reusable by the future RAG chat).
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key = settings.OPENAI_API_KEY)
    return _client


# Structured-output schema. The SDK compiles these to a strict JSON schema so the
# model can only return schema-valid data — no free-form text to parse.
class GeneratedQuestion(BaseModel):
    question_text: str
    explanation: str
    options: list[str]
    correct_index: int


class GeneratedQuiz(BaseModel):
    questions: list[GeneratedQuestion]


class LLMError(Exception):
    pass


SYSTEM_PROMPT = (
    "You are an assessment author. Write multiple-choice questions using ONLY the "
    "provided source material. Each question must have exactly 4 options with "
    "exactly one correct answer, and correct_index is the 0-based index of the "
    "correct option. Provide a short explanation for each answer."
)


# Asking the model for many questions in one call is unreliable: the JSON gets
# truncated at the output-token limit and the model drifts off exact large counts.
# Generate in small batches instead and accumulate until we have enough.
QUIZ_BATCH_SIZE = 10


async def generate_quiz(
    context: str,
    admin_prompt: str,
    num_questions: int,
    on_progress: Callable[[int], None] | None = None,
) -> list[GeneratedQuestion]:
    """Generate num_questions unique questions, one LLM batch at a time.

    on_progress is called after each batch with the running total, for callers that
    want to report progress. Note the granularity: a request at or below
    QUIZ_BATCH_SIZE is a single batch, so it only ever reports the finished count.
    """
    collected: list[GeneratedQuestion] = []
    seen: set[str] = set()
    # Cap attempts so a misbehaving model can't loop forever; the +4 headroom
    # absorbs count drift and duplicates across batches.
    max_attempts = num_questions // QUIZ_BATCH_SIZE + 4
    for _ in range(max_attempts):
        if len(collected) >= num_questions:
            break
        want = min(QUIZ_BATCH_SIZE, num_questions - len(collected))
        batch = await _generate_batch(
            context, admin_prompt, want, [q.question_text for q in collected]
        )
        for q in batch:
            key = q.question_text.strip().lower()
            if key not in seen:
                seen.add(key)
                collected.append(q)
        if on_progress is not None:
            # Capped for the same reason the return is sliced: a model that
            # over-returns must not report 12 of 10.
            on_progress(min(len(collected), num_questions))
    return collected[:num_questions]


async def _generate_batch(
    context: str, admin_prompt: str, count: int, avoid: list[str]
) -> list[GeneratedQuestion]:
    parts = [
        f"Generate exactly {count} multiple-choice questions.",
        f"Admin instructions: {admin_prompt}",
    ]
    if avoid:
        already = "\n".join(f"- {t}" for t in avoid)
        parts.append(
            "Do NOT repeat or rephrase any of these already-created questions:\n"
            f"{already}"
        )
    parts.append(f"Source material:\n{context}")
    user_prompt = "\n\n".join(parts)

    # Same contract as embed_query and stream_chat: every OpenAI failure leaves this
    # module as an LLMError. Without this a rate limit or timeout escapes as a raw
    # OpenAIError and the caller's `except LLMError` never fires, turning a 502 into
    # an unhandled 500.
    try:
        completion = await _get_client().chat.completions.parse(
            model = CHAT_MODEL,
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format = GeneratedQuiz,
        )
    except OpenAIError as e:
        raise LLMError(str(e))
    message = completion.choices[0].message
    if message.refusal:
        raise LLMError(message.refusal)
    return message.parsed.questions


CHAT_SYSTEM_PROMPT = (
    "You are a training mentor for employees. Answer using ONLY the source excerpts "
    "provided in the user's message and what has already been said in this "
    "conversation. Never use outside knowledge. Cite the sources you actually used "
    "by their number, like [Source 2]. If the excerpts and the conversation do not "
    "contain the answer, say plainly that it is not covered in the training "
    "materials — do not guess."
)


# The user message on this path is a generated breakdown of the questions the
# learner got wrong, so the question data is grounding in its own right — unlike
# CHAT_SYSTEM_PROMPT, the model may lean on it when no excerpt covers a question.
EXPLAIN_SYSTEM_PROMPT = (
    "You are a training mentor for employees. The user has just finished an exam "
    "and got the listed questions wrong. Write one short paragraph per question "
    "explaining why their answer was wrong and why the correct answer is right. "
    "Use ONLY the source excerpts and the question details in the user's message — "
    "never outside knowledge. Cite the excerpts you actually used by their number, "
    "like [Source 2]. If no excerpt covers a question, explain it from the options "
    "and the author's note and say the training materials do not cover it further. "
    "If the message says only some of the wrong questions are covered, repeat that "
    "at the end."
)


async def embed_query(text: str) -> list[float]:
    try:
        response = await _get_client().embeddings.create(
            model = EMBED_MODEL, input = text
        )
    except OpenAIError as e:
        raise LLMError(str(e))
    return response.data[0].embedding


# `usage` is filled in with the token totals once the final chunk arrives, since an
# async generator has no other way to hand the caller a value alongside the stream.
async def stream_chat(messages: list[dict], usage: dict) -> AsyncIterator[str]:
    try:
        stream = await _get_client().chat.completions.create(   # type: ignore[call-overload]
            model = CHAT_MODEL,
            messages = messages,
            stream = True,
            stream_options = {"include_usage": True},
        )
        async for chunk in stream:
            if chunk.usage is not None:
                usage["total_tokens"] = chunk.usage.total_tokens
            # Not every chunk carries a choice — the usage chunk arrives with an
            # empty list, which would blow up on [0].
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except OpenAIError as e:
        raise LLMError(str(e))
