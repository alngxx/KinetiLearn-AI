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


async def generate_quiz(
    context: str, admin_prompt: str, num_questions: int
) -> list[GeneratedQuestion]:
    user_prompt = (
        f"Generate exactly {num_questions} multiple-choice questions.\n\n"
        f"Admin instructions: {admin_prompt}\n\n"
        f"Source material:\n{context}"
    )
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
