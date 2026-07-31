from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.core.llm import GeneratedQuestion, LLMError, generate_quiz


def _q(text):
    return GeneratedQuestion(
        question_text = text,
        explanation = "e",
        options = ["a", "b", "c", "d"],
        correct_index = 0,
    )


def _completion(questions, refusal = None):
    message = SimpleNamespace(refusal = refusal, parsed = SimpleNamespace(questions = questions))
    return SimpleNamespace(choices = [SimpleNamespace(message = message)])


def _patch_parse(mock):
    client = SimpleNamespace(
        chat = SimpleNamespace(completions = SimpleNamespace(parse = mock))
    )
    return patch("app.core.llm._get_client", return_value = client)


async def test_batches_to_exact_count():
    # 25 requested -> 3 batches of 10 unique questions each, trimmed to 25.
    comps = [
        _completion([_q(f"Q{c}-{i}") for i in range(10)]) for c in range(3)
    ]
    parse = AsyncMock(side_effect = comps)
    with _patch_parse(parse):
        result = await generate_quiz("ctx", "prompt", 25)

    assert parse.call_count == 3
    assert len(result) == 25
    assert len({r.question_text for r in result}) == 25


async def test_small_count_single_call():
    parse = AsyncMock(side_effect = [_completion([_q("A"), _q("B"), _q("C")])])
    with _patch_parse(parse):
        result = await generate_quiz("ctx", "prompt", 3)

    assert parse.call_count == 1
    assert len(result) == 3


async def test_duplicates_are_dropped():
    # The model keeps returning the same 3 questions; dedup means we end up with
    # 3, not 5 (and don't loop forever).
    def same_batch(*args, **kwargs):
        return _completion([_q("A"), _q("B"), _q("C")])

    parse = AsyncMock(side_effect = same_batch)
    with _patch_parse(parse):
        result = await generate_quiz("ctx", "prompt", 5)

    assert len(result) == 3
    assert len({r.question_text for r in result}) == 3


async def test_refusal_raises():
    parse = AsyncMock(side_effect = [_completion([], refusal = "no")])
    with _patch_parse(parse):
        with pytest.raises(LLMError):
            await generate_quiz("ctx", "prompt", 5)
