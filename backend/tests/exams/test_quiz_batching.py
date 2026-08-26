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


async def test_on_progress_reports_the_running_total_per_batch():
    # 25 requested -> 3 batches, so the callback should see the total climb once
    # per batch rather than only at the end.
    comps = [
        _completion([_q(f"Q{c}-{i}") for i in range(10)]) for c in range(3)
    ]
    parse = AsyncMock(side_effect = comps)
    seen = []
    with _patch_parse(parse):
        result = await generate_quiz("ctx", "prompt", 25, on_progress = seen.append)

    assert len(result) == 25
    assert seen == [10, 20, 25]


async def test_on_progress_caps_at_the_requested_count():
    # The model over-returns on the final batch; progress must not report 30 of 25.
    comps = [
        _completion([_q(f"A{i}") for i in range(10)]),
        _completion([_q(f"B{i}") for i in range(10)]),
        _completion([_q(f"C{i}") for i in range(10)]),
    ]
    parse = AsyncMock(side_effect = comps)
    seen = []
    with _patch_parse(parse):
        await generate_quiz("ctx", "prompt", 25, on_progress = seen.append)

    assert seen[-1] == 25
    assert max(seen) == 25


# The single-batch case the waiting UI has to cope with: one call, one report, no
# intermediate progress to show.
async def test_on_progress_single_batch_reports_once():
    parse = AsyncMock(side_effect = [_completion([_q("A"), _q("B"), _q("C")])])
    seen = []
    with _patch_parse(parse):
        await generate_quiz("ctx", "prompt", 3, on_progress = seen.append)

    assert seen == [3]


async def test_omitting_on_progress_is_unchanged():
    parse = AsyncMock(side_effect = [_completion([_q("A"), _q("B")])])
    with _patch_parse(parse):
        result = await generate_quiz("ctx", "prompt", 2)

    assert len(result) == 2
