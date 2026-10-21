"""Compare the current chat pipeline with the LlamaIndex experiment.

Configs:
    A1, A2  current pipeline (production code), run twice to measure noise
    B       LlamaIndex, chunks 500/50, top_k = 5
    C       LlamaIndex, chunks 500/50, top_k = 3
    D       LlamaIndex, chunks 500/50, top_k = 8
    E       LlamaIndex, chunks 256/25, top_k = 5 (rebuild the index first)
    sweep   current retrieval only, top_k x MIN_SIMILARITY, no LLM answers

Run from backend/:
    python -m app.experiments.llamaindex_rag.evaluate --dry-run
    python -m app.experiments.llamaindex_rag.evaluate --configs sweep,A1,A2,B,C,D
    python -m app.experiments.llamaindex_rag.build_index --chunk-size 256 --overlap 25
    python -m app.experiments.llamaindex_rag.evaluate --configs E
    python -m app.experiments.llamaindex_rag.evaluate --report

Each config writes results/<name>.json. Saved sources keep the title, chunk
index and score but not the chunk text.
"""
import argparse
import asyncio
import json
import statistics
from pathlib import Path

import tiktoken
from openai import AsyncOpenAI
from pinecone import Pinecone
from pydantic import BaseModel

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.llm import CHAT_MODEL, CHAT_SYSTEM_PROMPT, EMBED_MODEL, GENERATION_MODEL
from app.experiments.llamaindex_rag.guard import EXPERIMENT_NAMESPACE, check_safe_target
from app.experiments.llamaindex_rag.result import RagResult

# The mapper needs every model module loaded before ChatService queries run.
import app.modules.config.models  # noqa: F401
import app.modules.auth.models  # noqa: F401
import app.modules.documents.models  # noqa: F401
import app.modules.classes.models  # noqa: F401
import app.modules.exams.models  # noqa: F401
import app.modules.scoring.models  # noqa: F401
import app.modules.quiz.models  # noqa: F401
import app.modules.chat.models  # noqa: F401

from app.experiments.llamaindex_rag.baseline import answer_current
from app.experiments.llamaindex_rag.query import answer_llamaindex
from app.modules.chat.service import ChatService

PRICES = {
    CHAT_MODEL: {"input": 0.10, "output": 0.50},
    GENERATION_MODEL: {"input": 2.00, "output": 10.00},
    EMBED_MODEL: {"input": 0.02, "output": 0.0},
}

CONFIGS = {
    "A1": {"pipeline": "current", "top_k": 5, "chunk_size": 500},
    "A2": {"pipeline": "current", "top_k": 5, "chunk_size": 500},
    "B": {"pipeline": "llamaindex", "top_k": 5, "chunk_size": 500},
    "C": {"pipeline": "llamaindex", "top_k": 3, "chunk_size": 500},
    "D": {"pipeline": "llamaindex", "top_k": 8, "chunk_size": 500},
    "E": {"pipeline": "llamaindex", "top_k": 5, "chunk_size": 256},
}
SWEEP_TOP_K = (3, 5, 8)
SWEEP_CUTOFFS = (0.15, 0.25, 0.35)

JUDGE_MODEL = GENERATION_MODEL
# Upper-bound guesses used only by the cost estimate.
ASSUMED_ANSWER_TOKENS = 300
ASSUMED_JUDGE_OUTPUT_TOKENS = 100

HERE = Path(__file__).parent
QUESTIONS_PATH = HERE / "questions.json"
RESULTS_DIR = HERE / "results"

_encoding = tiktoken.get_encoding("o200k_base")

JUDGE_PROMPT = (
    "You grade answers from a training chatbot that must answer only from retrieved "
    "source excerpts. Judge ONLY against the expected answer and the retrieved "
    "sources given to you. Do not use your own knowledge of the topic: a claim that "
    "is true in the real world but appears in neither the expected answer nor the "
    "sources counts as unsupported.\n\n"
    "For an answerable question, score 1 to 5:\n"
    "5 - correct and complete against the expected answer; every claim is supported "
    "by the sources.\n"
    "4 - correct with a small omission; no unsupported claims.\n"
    "3 - partly correct, vague, or missing a key part of the expected answer.\n"
    "2 - mostly wrong, or makes important claims the sources do not support.\n"
    "1 - wrong, off-topic, or invented.\n\n"
    "For an unanswerable question, the correct behavior is to say the training "
    "materials do not cover it:\n"
    "5 - clearly says it is not covered and adds no invented facts.\n"
    "3 - says it is not covered but also offers unsupported details or guesses.\n"
    "1 - gives a substantive answer, such as a number or a rule, as if the "
    "materials contained it.\n\n"
    "Return the score and a one-sentence reason."
)


class JudgeVerdict(BaseModel):
    score: int
    reason: str


def count_tokens(text: str) -> int:
    return len(_encoding.encode(text))


def load_questions() -> list[dict]:
    return json.loads(QUESTIONS_PATH.read_text())


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float | None:
    price = PRICES[model]
    if price["input"] is None or price["output"] is None:
        return None
    return (input_tokens * price["input"] + output_tokens * price["output"]) / 1_000_000


def prices_missing() -> list[str]:
    return [model for model, price in PRICES.items() if None in price.values()]


def estimate(questions: list[dict], names: list[str]) -> dict:
    usage = {model: {"calls": 0, "input": 0, "output": 0} for model in PRICES}
    system_tokens = count_tokens(CHAT_SYSTEM_PROMPT)
    judge_tokens = count_tokens(JUDGE_PROMPT)

    for name in names:
        for q in questions:
            question_tokens = count_tokens(q["question"])
            usage[EMBED_MODEL]["calls"] += 1
            usage[EMBED_MODEL]["input"] += question_tokens
            if name == "sweep":
                continue

            # Upper bound: every question reaches the LLM and every chunk is full.
            context = CONFIGS[name]["top_k"] * CONFIGS[name]["chunk_size"]
            usage[CHAT_MODEL]["calls"] += 1
            usage[CHAT_MODEL]["input"] += system_tokens + context + question_tokens + 30
            usage[CHAT_MODEL]["output"] += ASSUMED_ANSWER_TOKENS

            usage[JUDGE_MODEL]["calls"] += 1
            usage[JUDGE_MODEL]["input"] += (
                judge_tokens + question_tokens + count_tokens(q["expected_answer"])
                + ASSUMED_ANSWER_TOKENS + context + 50
            )
            usage[JUDGE_MODEL]["output"] += ASSUMED_JUDGE_OUTPUT_TOKENS
    return usage


def print_estimate(usage: dict) -> None:
    print(f"{'Model':26} {'calls':>6} {'input tok':>10} {'output tok':>11} {'cost':>10}")
    total = 0.0
    unknown = False
    for model, u in usage.items():
        cost = cost_usd(model, u["input"], u["output"])
        if cost is None:
            unknown = True
            shown = "PRICES?"
        else:
            total += cost
            shown = f"${cost:.4f}"
        print(f"{model:26} {u['calls']:>6} {u['input']:>10} {u['output']:>11} {shown:>10}")
    print(f"{'TOTAL (upper bound)':26} {'':>6} {'':>10} {'':>11} "
          f"{'PRICES?' if unknown else f'${total:.4f}':>10}")
    print("Index builds are estimated separately by build_index --dry-run.")


def namespace_chunk_size(pinecone_index) -> int | None:
    page = pinecone_index.list_paginated(namespace = EXPERIMENT_NAMESPACE, limit = 1)
    if not page.vectors:
        return None
    vector_id = page.vectors[0].id
    fetched = pinecone_index.fetch(ids = [vector_id], namespace = EXPERIMENT_NAMESPACE)
    return fetched.vectors[vector_id].metadata.get("chunk_size")


def check_namespace_matches(names: list[str]) -> None:
    wanted = {CONFIGS[n]["chunk_size"] for n in names if n in CONFIGS and CONFIGS[n]["pipeline"] == "llamaindex"}
    if not wanted:
        return
    if len(wanted) > 1:
        raise SystemExit("B, C and D need the 500/50 index and E needs 256/25: run E separately.")

    pinecone_index = Pinecone(api_key = settings.PINECONE_API_KEY).Index(settings.PINECONE_INDEX)
    built = namespace_chunk_size(pinecone_index)
    needed = wanted.pop()
    if built != needed:
        raise SystemExit(
            f"Namespace '{EXPERIMENT_NAMESPACE}' holds chunk_size = {built}, these configs need "
            f"{needed}. Run build_index --chunk-size {needed} first."
        )


def source_hit(question: dict, result: RagResult) -> bool | None:
    if not question["answerable"]:
        return None
    # A gated result sends no chunks to the LLM, so nothing it retrieved counts.
    if result.no_match:
        return False
    titles = {c.document_title for c in result.citations}
    return all(doc in titles for doc in question["expected_documents"])


async def judge(client: AsyncOpenAI, question: dict, result: RagResult) -> dict:
    # The canned answer needs no judge: it is right exactly when the question
    # has no answer.
    if result.no_match:
        return {
            "score": 1 if question["answerable"] else 5,
            "reason": "Canned no-match answer, scored without a judge call.",
            "prompt_tokens": 0,
            "completion_tokens": 0,
        }

    sources = "\n\n".join(
        f"[Source {i}] {c.document_title}, chunk {c.chunk_index}:\n{c.content}"
        for i, c in enumerate(result.citations, start = 1)
    )
    user_prompt = "\n\n".join([
        f"Question: {question['question']}",
        f"Answerable from the materials: {'yes' if question['answerable'] else 'no'}",
        f"Expected answer: {question['expected_answer']}",
        f"Retrieved sources:\n{sources}",
        f"Answer to grade:\n{result.answer}",
    ])
    completion = await client.chat.completions.parse(
        model = JUDGE_MODEL,
        messages = [
            {"role": "system", "content": JUDGE_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        response_format = JudgeVerdict,
        reasoning_effort = "low",
    )
    verdict = completion.choices[0].message.parsed
    if verdict is None or not 1 <= verdict.score <= 5:
        raise ValueError(f"Unusable judge output: {completion.choices[0].message.content!r}")
    return {
        "score": verdict.score,
        "reason": verdict.reason,
        "prompt_tokens": completion.usage.prompt_tokens,
        "completion_tokens": completion.usage.completion_tokens,
    }


async def run_config(name: str, questions: list[dict], db, client: AsyncOpenAI) -> None:
    config = CONFIGS[name]
    records = []
    for q in questions:
        try:
            if config["pipeline"] == "current":
                result = await answer_current(db, q["question"], config["top_k"])
            else:
                result = await asyncio.to_thread(answer_llamaindex, q["question"], config["top_k"])
            verdict = await judge(client, q, result)
        except Exception as e:
            records.append({"id": q["id"], "error": f"{type(e).__name__}: {e}"})
            print(f"  {name} {q['id']}  ERROR {e}")
            continue

        records.append({
            "id": q["id"],
            "type": q["type"],
            "answerable": q["answerable"],
            "answer": result.answer,
            "sources": [
                {"title": c.document_title, "chunk_index": c.chunk_index, "score": round(c.relevance_score, 4)}
                for c in result.citations
            ],
            "no_match": result.no_match,
            "source_hit": source_hit(q, result),
            "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens,
            "total_tokens": result.total_tokens,
            "tokens_estimated": result.tokens_estimated,
            "latency_ms": result.latency_ms,
            "cost_usd": cost_usd(CHAT_MODEL, result.prompt_tokens, result.completion_tokens),
            "judge_score": verdict["score"],
            "judge_reason": verdict["reason"],
            "judge_cost_usd": cost_usd(JUDGE_MODEL, verdict["prompt_tokens"], verdict["completion_tokens"]),
        })
        print(f"  {name} {q['id']}  score {verdict['score']}  hit {records[-1]['source_hit']}  "
              f"{result.latency_ms} ms  {result.total_tokens} tok")

    RESULTS_DIR.mkdir(exist_ok = True)
    (RESULTS_DIR / f"{name}.json").write_text(
        json.dumps({"config": name, **config, "records": records}, indent = 2)
    )


# Retrieval only, so no answers or judge calls. Each question is searched once
# at the largest k, and smaller k values are prefixes of that ranking. The
# cutoff follows production's rule: if the best chunk is below it, nothing
# reaches the LLM; otherwise all top-k chunks do.
async def run_sweep(questions: list[dict], db) -> None:
    service = ChatService(db)
    scope = await service._active_scope()
    rows = []
    for q in questions:
        hits = await service._retrieve(q["question"], scope, max(SWEEP_TOP_K))
        rows.append({
            "id": q["id"],
            "answerable": q["answerable"],
            "expected_documents": q["expected_documents"],
            "best_score": round(hits[0][2], 4) if hits else 0.0,
            "titles": [title for _, title, _ in hits],
        })

    answerable = [r for r in rows if r["answerable"]]
    unanswerable = [r for r in rows if not r["answerable"]]
    grid = []
    for top_k in SWEEP_TOP_K:
        for cutoff in SWEEP_CUTOFFS:
            hits = sum(
                r["best_score"] >= cutoff and all(d in r["titles"][:top_k] for d in r["expected_documents"])
                for r in answerable
            )
            false_accepts = sum(r["best_score"] >= cutoff for r in unanswerable)
            grid.append({
                "top_k": top_k,
                "cutoff": cutoff,
                "source_hits": hits,
                "answerable": len(answerable),
                "false_accepts": false_accepts,
                "unanswerable": len(unanswerable),
            })

    print(f"\n{'top_k':>5} {'cutoff':>6} {'source_hit':>12} {'false_accept':>13}")
    for g in grid:
        print(f"{g['top_k']:>5} {g['cutoff']:>6} {g['source_hits']:>6}/{g['answerable']:<5} "
              f"{g['false_accepts']:>6}/{g['unanswerable']}")

    RESULTS_DIR.mkdir(exist_ok = True)
    (RESULTS_DIR / "sweep.json").write_text(json.dumps({"rows": rows, "grid": grid}, indent = 2))


def percentile(values: list[int], fraction: float) -> int:
    ordered = sorted(values)
    return ordered[round(fraction * (len(ordered) - 1))]


def print_report() -> None:
    runs = {}
    for name in CONFIGS:
        path = RESULTS_DIR / f"{name}.json"
        if path.exists():
            runs[name] = {r["id"]: r for r in json.loads(path.read_text())["records"]}
    if not runs:
        raise SystemExit("No results yet.")

    print(f"{'cfg':4} {'hit':>6} {'judge(ans)':>10} {'judge(unans)':>12} {'p50 ms':>7} "
          f"{'p95 ms':>7} {'tokens':>7} {'cost':>9} {'errors':>6}")
    for name, records in runs.items():
        ok = [r for r in records.values() if "error" not in r]
        ans = [r for r in ok if r["answerable"]]
        unans = [r for r in ok if not r["answerable"]]
        latencies = [r["latency_ms"] for r in ok]
        costs = [r["cost_usd"] for r in ok if r["cost_usd"] is not None]
        print(
            f"{name:4} {sum(r['source_hit'] for r in ans):>3}/{len(ans):<2} "
            f"{statistics.mean(r['judge_score'] for r in ans):>10.2f} "
            f"{statistics.mean(r['judge_score'] for r in unans):>12.2f} "
            f"{percentile(latencies, 0.5):>7} {percentile(latencies, 0.95):>7} "
            f"{sum(r['total_tokens'] for r in ok):>7} ${sum(costs):>8.4f} "
            f"{len(records) - len(ok):>6}"
        )

    ids = sorted({i for records in runs.values() for i in records})
    print("\nJudge score per question:")
    print("id   " + " ".join(f"{n:>4}" for n in runs))
    for i in ids:
        print(f"{i:4} " + " ".join(f"{runs[n].get(i, {}).get('judge_score', '-'):>4}" for n in runs))

    if "A1" in runs and "A2" in runs:
        shared = [i for i in ids if "judge_score" in runs["A1"].get(i, {}) and "judge_score" in runs["A2"].get(i, {})]
        diffs = [runs["A2"][i]["judge_score"] - runs["A1"][i]["judge_score"] for i in shared]
        changed = [i for i, d in zip(shared, diffs) if d != 0]
        print(f"\nNoise (A2 - A1): {len(changed)}/{len(shared)} questions changed score, "
              f"mean diff {statistics.mean(diffs):+.2f}, largest |diff| {max(abs(d) for d in diffs)}"
              f"{', changed: ' + ', '.join(changed) if changed else ''}")


async def run(names: list[str], questions: list[dict]) -> None:
    client = AsyncOpenAI(api_key = settings.OPENAI_API_KEY)
    async with SessionLocal() as db:
        for name in names:
            print(f"\n== {name}")
            if name == "sweep":
                await run_sweep(questions, db)
            else:
                await run_config(name, questions, db, client)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--configs", default = "sweep,A1,A2,B,C,D")
    parser.add_argument("--dry-run", action = "store_true")
    parser.add_argument("--yes", action = "store_true", help = "skip the confirmation prompt")
    parser.add_argument("--report", action = "store_true")
    args = parser.parse_args()

    if args.report:
        print_report()
        return

    names = [n.strip() for n in args.configs.split(",")]
    unknown = [n for n in names if n != "sweep" and n not in CONFIGS]
    if unknown:
        raise SystemExit(f"Unknown configs: {', '.join(unknown)}")
    if any(n in CONFIGS and CONFIGS[n]["pipeline"] == "llamaindex" for n in names):
        check_safe_target(settings.PINECONE_INDEX, EXPERIMENT_NAMESPACE, settings.ENVIRONMENT)

    questions = load_questions()
    print(f"{len(questions)} questions, configs: {', '.join(names)}\n")
    print_estimate(estimate(questions, names))

    if args.dry_run:
        print("\nDry run: no API calls made.")
        return
    missing = prices_missing()
    if missing:
        raise SystemExit(f"Fill in PRICES for {', '.join(missing)} before a paid run.")
    if not args.yes and input("\nRun now? [y/N] ").strip().lower() != "y":
        print("Aborted.")
        return

    check_namespace_matches(names)
    asyncio.run(run(names, questions))


if __name__ == "__main__":
    main()
