from openai import AsyncOpenAI
from pydantic import BaseModel

from app.core.config import settings

CHAT_MODEL = "gpt-4o"

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
    context: str, admin_prompt: str, num_questions: int
) -> list[GeneratedQuestion]:
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

    completion = await _get_client().chat.completions.parse(
        model = CHAT_MODEL,
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        response_format = GeneratedQuiz,
    )
    message = completion.choices[0].message
    if message.refusal:
        raise LLMError(message.refusal)
    return message.parsed.questions
