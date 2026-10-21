"""The isolated LlamaIndex experiment: the guard, the Pinecone adapter, the
query function, the current-pipeline wrapper and the evaluation scoring.

No network calls. Pinecone is a MagicMock, the LLM is a fake OpenAI client,
and LlamaIndex's MockEmbedding plus its in-memory vector store stand in for
OpenAI embeddings and Pinecone wherever a real index is needed. The module is
skipped when llama_index is not installed, as in CI.
"""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

pytest.importorskip("llama_index.core")

from llama_index.core import VectorStoreIndex
from llama_index.core.embeddings import MockEmbedding
from llama_index.core.schema import TextNode
from llama_index.core.vector_stores.types import (
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
    VectorStoreQuery,
)

from app.experiments.llamaindex_rag import baseline, evaluate
from app.experiments.llamaindex_rag.guard import (
    EXPERIMENT_NAMESPACE,
    UnsafeTargetError,
    check_safe_target,
)
from app.experiments.llamaindex_rag.llm import ExperimentChatLLM
from app.experiments.llamaindex_rag.pinecone_store import ExperimentPineconeStore
from app.experiments.llamaindex_rag.query import answer_llamaindex
from app.experiments.llamaindex_rag.result import Citation, RagResult
from app.modules.chat.service import NO_MATCH_ANSWER


def fake_openai(content = "Answer [Source 1].", prompt_tokens = 100, completion_tokens = 10):
    completions = MagicMock()
    completions.create.return_value = SimpleNamespace(
        choices = [SimpleNamespace(message = SimpleNamespace(content = content))],
        usage = SimpleNamespace(
            prompt_tokens = prompt_tokens,
            completion_tokens = completion_tokens,
            total_tokens = prompt_tokens + completion_tokens,
        ),
    )
    return SimpleNamespace(chat = SimpleNamespace(completions = completions))


def memory_index() -> VectorStoreIndex:
    nodes = [
        TextNode(
            text = f"chunk text {i}",
            metadata = {"document_id": "doc-1", "title": "What is Claude", "chunk_index": i},
        )
        for i in range(3)
    ]
    return VectorStoreIndex(nodes, embed_model = MockEmbedding(embed_dim = 8))


# --- guard ---

@pytest.mark.parametrize("index_name, namespace, environment", [
    ("kinetilearn-prod", EXPERIMENT_NAMESPACE, "dev"),
    ("KinetiLearn-PROD", EXPERIMENT_NAMESPACE, "dev"),
    ("", EXPERIMENT_NAMESPACE, "dev"),
    ("kinetilearn", "", "dev"),
    ("kinetilearn", "__default__", "dev"),
    ("kinetilearn", EXPERIMENT_NAMESPACE, "production"),
])
def test_guard_refuses_unsafe_targets(index_name, namespace, environment):
    with pytest.raises(UnsafeTargetError):
        check_safe_target(index_name, namespace, environment)


def test_guard_allows_the_dev_experiment_namespace():
    check_safe_target("kinetilearn", EXPERIMENT_NAMESPACE, "dev")


# --- Pinecone adapter ---

def test_store_refuses_to_build_against_a_prod_index():
    with pytest.raises(UnsafeTargetError):
        ExperimentPineconeStore(MagicMock(), "kinetilearn-prod", "dev")


def test_store_clear_deletes_only_the_experiment_namespace():
    index = MagicMock()
    ExperimentPineconeStore(index, "kinetilearn", "dev").clear()
    index.delete.assert_called_once_with(delete_all = True, namespace = EXPERIMENT_NAMESPACE)


def test_store_add_writes_text_into_the_experiment_namespace():
    index = MagicMock()
    node = TextNode(text = "hello", metadata = {"title": "T"}, embedding = [0.1, 0.2])
    ExperimentPineconeStore(index, "kinetilearn", "dev").add([node])

    kwargs = index.upsert.call_args.kwargs
    assert kwargs["namespace"] == EXPERIMENT_NAMESPACE
    # Pinecone rejects a single request over 4 MB.
    assert kwargs["batch_size"] == 100
    assert kwargs["vectors"][0]["metadata"]["text"] == "hello"
    assert kwargs["vectors"][0]["values"] == [0.1, 0.2]


def test_store_query_rebuilds_nodes_and_clamps_scores():
    index = MagicMock()
    index.query.return_value = SimpleNamespace(matches = [
        SimpleNamespace(id = "a", score = 1.2, metadata = {"text": "first", "title": "T", "ref_doc_id": "d"}),
        SimpleNamespace(id = "b", score = -0.1, metadata = {"text": "second", "title": "T"}),
    ])
    store = ExperimentPineconeStore(index, "kinetilearn", "dev")
    result = store.query(VectorStoreQuery(query_embedding = [0.1], similarity_top_k = 2))

    assert index.query.call_args.kwargs["namespace"] == EXPERIMENT_NAMESPACE
    assert [n.get_content() for n in result.nodes] == ["first", "second"]
    assert "ref_doc_id" not in result.nodes[0].metadata
    assert result.similarities == [1.0, 0.0]


def test_store_rejects_metadata_filters():
    store = ExperimentPineconeStore(MagicMock(), "kinetilearn", "dev")
    filters = MetadataFilters(filters = [MetadataFilter(key = "title", value = "T", operator = FilterOperator.EQ)])
    with pytest.raises(NotImplementedError):
        store.query(VectorStoreQuery(query_embedding = [0.1], similarity_top_k = 1, filters = filters))


# --- LlamaIndex query ---

def test_answer_llamaindex_returns_the_shared_result_shape():
    client = fake_openai()
    result = answer_llamaindex(
        "What is Claude?", top_k = 2, index = memory_index(), llm = ExperimentChatLLM(client = client)
    )

    assert isinstance(result, RagResult)
    assert result.answer == "Answer [Source 1]."
    assert len(result.citations) == 2
    assert result.citations[0].document_title == "What is Claude"
    assert (result.prompt_tokens, result.completion_tokens, result.total_tokens) == (100, 10, 110)
    assert result.no_match is False
    assert result.tokens_estimated is False

    sent = client.chat.completions.create.call_args.kwargs
    assert [m["role"] for m in sent["messages"]] == ["system", "user"]
    assert '[Source 1] from "What is Claude"' in sent["messages"][1]["content"]
    assert sent["reasoning_effort"] == "none"


def test_answer_llamaindex_below_cutoff_skips_the_llm():
    client = fake_openai()
    result = answer_llamaindex(
        "anything", min_similarity = 1.01, index = memory_index(), llm = ExperimentChatLLM(client = client)
    )

    assert result.no_match is True
    assert result.answer == NO_MATCH_ANSWER
    client.chat.completions.create.assert_not_called()


# --- current-pipeline wrapper ---

async def test_answer_current_uses_production_code_without_persisting(monkeypatch):
    chunk = SimpleNamespace(document_id = uuid4(), chunk_index = 0, content = "Claude is a model.")
    monkeypatch.setattr(baseline.ChatService, "_active_scope", AsyncMock(return_value = [(uuid4(), 1)]))
    monkeypatch.setattr(
        baseline.ChatService, "_retrieve", AsyncMock(return_value = [(chunk, "What is Claude", 0.6)])
    )
    persist = AsyncMock()
    monkeypatch.setattr(baseline.ChatService, "_persist_turn", persist)

    async def fake_stream(messages, usage):
        usage["total_tokens"] = 500
        yield "Claude is "
        yield "a model."

    monkeypatch.setattr(baseline, "stream_chat", fake_stream)
    result = await baseline.answer_current(MagicMock(), "What is Claude?")

    assert result.answer == "Claude is a model."
    assert result.citations[0].document_title == "What is Claude"
    assert result.total_tokens == 500
    assert result.prompt_tokens + result.completion_tokens == 500
    assert result.tokens_estimated is True
    persist.assert_not_called()


async def test_answer_current_below_cutoff_returns_canned_answer(monkeypatch):
    chunk = SimpleNamespace(document_id = uuid4(), chunk_index = 0, content = "x")
    monkeypatch.setattr(baseline.ChatService, "_active_scope", AsyncMock(return_value = [(uuid4(), 1)]))
    monkeypatch.setattr(baseline.ChatService, "_retrieve", AsyncMock(return_value = [(chunk, "T", 0.1)]))
    stream = MagicMock()
    monkeypatch.setattr(baseline, "stream_chat", stream)

    result = await baseline.answer_current(MagicMock(), "unrelated")

    assert result.no_match is True
    assert result.answer == NO_MATCH_ANSWER
    stream.assert_not_called()


# --- scoring ---

def citation(title):
    return Citation(document_id = "d", document_title = title, chunk_index = 0, relevance_score = 0.5, content = "c")


def test_source_hit_needs_every_expected_document():
    question = {"answerable": True, "expected_documents": ["A", "B"]}
    assert evaluate.source_hit(question, RagResult(answer = "", citations = [citation("A"), citation("B")])) is True
    assert evaluate.source_hit(question, RagResult(answer = "", citations = [citation("A")])) is False


def test_source_hit_is_false_when_the_cutoff_gated_the_chunks():
    question = {"answerable": True, "expected_documents": ["A"]}
    result = RagResult(answer = NO_MATCH_ANSWER, citations = [citation("A")], no_match = True)
    assert evaluate.source_hit(question, result) is False


def test_source_hit_is_none_for_unanswerable_questions():
    question = {"answerable": False, "expected_documents": []}
    assert evaluate.source_hit(question, RagResult(answer = "")) is None


def test_cost_uses_per_million_prices(monkeypatch):
    monkeypatch.setitem(evaluate.PRICES, "gpt-6-luna", {"input": 2.0, "output": 8.0})
    assert evaluate.cost_usd("gpt-6-luna", 1_000_000, 500_000) == pytest.approx(6.0)


def test_cost_is_none_while_prices_are_missing(monkeypatch):
    monkeypatch.setitem(evaluate.PRICES, "gpt-6-luna", {"input": None, "output": None})
    assert evaluate.cost_usd("gpt-6-luna", 10, 10) is None


# --- judge ---

async def test_judge_scores_canned_answers_without_a_call():
    client = MagicMock()
    canned = RagResult(answer = NO_MATCH_ANSWER, no_match = True)

    assert (await evaluate.judge(client, {"answerable": False}, canned))["score"] == 5
    assert (await evaluate.judge(client, {"answerable": True}, canned))["score"] == 1
    client.chat.completions.parse.assert_not_called()


def judge_client(verdict):
    client = MagicMock()
    client.chat.completions.parse = AsyncMock(return_value = SimpleNamespace(
        choices = [SimpleNamespace(message = SimpleNamespace(parsed = verdict, content = "raw"))],
        usage = SimpleNamespace(prompt_tokens = 300, completion_tokens = 20),
    ))
    return client


QUESTION = {"question": "Q?", "answerable": True, "expected_answer": "E."}


async def test_judge_sends_expected_answer_and_sources():
    client = judge_client(evaluate.JudgeVerdict(score = 4, reason = "small omission"))
    result = RagResult(answer = "A.", citations = [citation("What is Claude")])

    verdict = await evaluate.judge(client, QUESTION, result)

    assert verdict["score"] == 4
    assert verdict["prompt_tokens"] == 300
    user_prompt = client.chat.completions.parse.call_args.kwargs["messages"][1]["content"]
    assert "Expected answer: E." in user_prompt
    assert "What is Claude, chunk 0:\nc" in user_prompt


async def test_judge_rejects_out_of_range_scores():
    client = judge_client(evaluate.JudgeVerdict(score = 9, reason = "?"))
    with pytest.raises(ValueError):
        await evaluate.judge(client, QUESTION, RagResult(answer = "A."))


# --- sweep ---

async def test_sweep_gate_and_prefixes(monkeypatch, tmp_path):
    def chunk():
        return SimpleNamespace(document_id = uuid4(), chunk_index = 0, content = "x")

    rankings = {
        "answerable": [(chunk(), "Other", 0.30)] * 4 + [(chunk(), "Doc", 0.29)] + [(chunk(), "Other", 0.2)] * 3,
        "unanswerable": [(chunk(), "Other", 0.20)] * 8,
    }
    monkeypatch.setattr(evaluate.ChatService, "_active_scope", AsyncMock(return_value = [(uuid4(), 1)]))
    monkeypatch.setattr(
        evaluate.ChatService, "_retrieve", AsyncMock(side_effect = lambda q, scope, k: rankings[q])
    )
    monkeypatch.setattr(evaluate, "RESULTS_DIR", tmp_path)
    questions = [
        {"id": "q1", "question": "answerable", "answerable": True, "expected_documents": ["Doc"]},
        {"id": "q2", "question": "unanswerable", "answerable": False, "expected_documents": []},
    ]

    await evaluate.run_sweep(questions, MagicMock())

    grid = {(g["top_k"], g["cutoff"]): g for g in json.loads((tmp_path / "sweep.json").read_text())["grid"]}
    # "Doc" is fifth: missed at k = 3, found at k = 5 once the best chunk passes.
    assert grid[(3, 0.25)]["source_hits"] == 0
    assert grid[(5, 0.25)]["source_hits"] == 1
    assert grid[(5, 0.35)]["source_hits"] == 0
    # The gate looks only at the best chunk, so false accepts do not depend on k.
    assert {grid[(k, 0.15)]["false_accepts"] for k in (3, 5, 8)} == {1}
    assert grid[(5, 0.25)]["false_accepts"] == 0


# --- run safety ---

def test_evaluate_aborts_without_confirmation(monkeypatch):
    for model in evaluate.PRICES:
        monkeypatch.setitem(evaluate.PRICES, model, {"input": 1.0, "output": 1.0})
    monkeypatch.setattr("sys.argv", ["evaluate", "--configs", "sweep"])
    monkeypatch.setattr("builtins.input", lambda prompt: "n")
    run = MagicMock()
    monkeypatch.setattr(evaluate, "run", run)

    evaluate.main()

    run.assert_not_called()


def test_evaluate_refuses_a_paid_run_without_prices(monkeypatch):
    monkeypatch.setitem(evaluate.PRICES, "gpt-6-luna", {"input": None, "output": None})
    monkeypatch.setattr("sys.argv", ["evaluate", "--configs", "sweep", "--yes"])
    with pytest.raises(SystemExit):
        evaluate.main()


def test_namespace_check_refuses_mixed_chunk_sizes():
    with pytest.raises(SystemExit):
        evaluate.check_namespace_matches(["B", "E"])


def test_namespace_check_refuses_a_mismatched_build(monkeypatch):
    pinecone_index = MagicMock()
    pinecone_index.list_paginated.return_value = SimpleNamespace(vectors = [SimpleNamespace(id = "v1")])
    pinecone_index.fetch.return_value = SimpleNamespace(
        vectors = {"v1": SimpleNamespace(metadata = {"chunk_size": 256})}
    )
    monkeypatch.setattr(evaluate, "Pinecone", MagicMock(return_value = MagicMock(Index = MagicMock(return_value = pinecone_index))))

    with pytest.raises(SystemExit):
        evaluate.check_namespace_matches(["B"])
    pinecone_index.list_paginated.assert_called_once_with(namespace = EXPERIMENT_NAMESPACE, limit = 1)
