"""Build the LlamaIndex experiment index in Pinecone namespace "llamaindex-exp".

Reads the documents the chatbot answers from (active document, promoted and
ready version), downloads each file from R2, extracts text with the worker's
own extract_text, chunks it with LlamaIndex's SentenceSplitter and embeds it
with text-embedding-3-small. Postgres is read only.

Run from backend/:
    python -m app.experiments.llamaindex_rag.build_index --dry-run
    python -m app.experiments.llamaindex_rag.build_index
    python -m app.experiments.llamaindex_rag.build_index --chunk-size 256 --overlap 25
"""
import argparse
import asyncio
import time

import tiktoken
from llama_index.core import Document as LlamaDocument
from llama_index.core import StorageContext, VectorStoreIndex
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.openai import OpenAIEmbedding
from pinecone import Pinecone
from sqlalchemy import func, select

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.storage import R2Storage
from app.experiments.llamaindex_rag.guard import EXPERIMENT_NAMESPACE, check_safe_target
from app.experiments.llamaindex_rag.pinecone_store import ExperimentPineconeStore

# The mapper needs every model module loaded before the first query, the same
# list scripts/reembed_to_pinecone.py imports.
import app.modules.config.models  # noqa: F401
import app.modules.auth.models  # noqa: F401
import app.modules.documents.models  # noqa: F401
import app.modules.classes.models  # noqa: F401
import app.modules.exams.models  # noqa: F401
import app.modules.scoring.models  # noqa: F401
import app.modules.quiz.models  # noqa: F401
import app.modules.chat.models  # noqa: F401

from app.modules.documents.models import Document, DocumentChunk, DocumentVersion
from worker.processing import EMBED_MODEL, extract_text

EMBED_PRICE_PER_1M_TOKENS = 0.02
METADATA_KEYS = ["document_id", "version_number", "title", "chunk_index", "chunk_size"]

_encoding = tiktoken.encoding_for_model(EMBED_MODEL)


# Same visibility rule as ChatService._active_scope, plus the production chunk
# count per version for the side-by-side printout.
async def load_sources() -> list:
    chunk_counts = (
        select(
            DocumentChunk.document_id,
            DocumentChunk.version_number,
            func.count().label("chunks"),
        )
        .group_by(DocumentChunk.document_id, DocumentChunk.version_number)
        .subquery()
    )
    async with SessionLocal() as db:
        result = await db.execute(
            select(
                Document.id,
                Document.title,
                DocumentVersion.version_number,
                DocumentVersion.file_url,
                DocumentVersion.mime_type,
                func.coalesce(chunk_counts.c.chunks, 0),
            )
            .join(
                DocumentVersion,
                (DocumentVersion.document_id == Document.id)
                & (DocumentVersion.version_number == Document.active_version_number),
            )
            .outerjoin(
                chunk_counts,
                (chunk_counts.c.document_id == Document.id)
                & (chunk_counts.c.version_number == DocumentVersion.version_number),
            )
            .where(
                Document.is_active.is_(True),
                DocumentVersion.processing_status == "ready",
            )
            .order_by(Document.title)
        )
        return result.all()


def build_nodes(rows: list, chunk_size: int, overlap: int) -> list:
    storage = R2Storage()
    documents = []
    for document_id, title, version_number, file_url, mime_type, _ in rows:
        text = extract_text(mime_type, storage.download(file_url))
        documents.append(LlamaDocument(
            id_ = f"{document_id}:{version_number}",
            text = text,
            metadata = {
                "document_id": str(document_id),
                "version_number": version_number,
                "title": title,
            },
            # Production embeds the bare chunk text. Excluding the metadata keeps
            # it out of the embedding and out of the splitter's size budget.
            excluded_embed_metadata_keys = METADATA_KEYS,
            excluded_llm_metadata_keys = METADATA_KEYS,
        ))

    # Same tokenizer production chunks with, so a token means the same thing.
    splitter = SentenceSplitter(
        chunk_size = chunk_size,
        chunk_overlap = overlap,
        tokenizer = _encoding.encode,
    )
    nodes = splitter.get_nodes_from_documents(documents)

    next_index: dict[str, int] = {}
    for node in nodes:
        index = next_index.get(node.ref_doc_id, 0)
        node.metadata["chunk_index"] = index
        # Lets evaluate.py check which chunking the namespace currently holds.
        node.metadata["chunk_size"] = chunk_size
        next_index[node.ref_doc_id] = index + 1
    return nodes


def namespace_counts(pinecone_index) -> dict[str, int]:
    stats = pinecone_index.describe_index_stats()
    return {name: ns.vector_count for name, ns in stats.namespaces.items()}


def print_summary(rows: list, nodes: list, tokens: int) -> None:
    per_doc: dict[str, int] = {}
    for node in nodes:
        per_doc[node.ref_doc_id] = per_doc.get(node.ref_doc_id, 0) + 1

    print(f"{'Document':60} {'current':>8} {'llamaindex':>11}")
    for document_id, title, version_number, _, _, prod_chunks in rows:
        li_chunks = per_doc.get(f"{document_id}:{version_number}", 0)
        print(f"{title[:60]:60} {prod_chunks:>8} {li_chunks:>11}")
    print(f"{'TOTAL':60} {sum(r[5] for r in rows):>8} {len(nodes):>11}")

    cost = tokens / 1_000_000 * EMBED_PRICE_PER_1M_TOKENS
    print(f"\n{len(rows)} documents, {len(nodes)} chunks, {tokens} tokens to embed")
    print(f"Estimated embedding cost: ${cost:.4f} at ${EMBED_PRICE_PER_1M_TOKENS}/1M tokens")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chunk-size", type = int, default = 500)
    parser.add_argument("--overlap", type = int, default = 50)
    parser.add_argument("--dry-run", action = "store_true")
    args = parser.parse_args()

    check_safe_target(settings.PINECONE_INDEX, EXPERIMENT_NAMESPACE, settings.ENVIRONMENT)

    rows = asyncio.run(load_sources())
    nodes = build_nodes(rows, args.chunk_size, args.overlap)
    tokens = sum(len(_encoding.encode(node.get_content())) for node in nodes)
    print(f"Chunking: SentenceSplitter, chunk_size = {args.chunk_size}, overlap = {args.overlap}\n")
    print_summary(rows, nodes, tokens)

    if args.dry_run:
        print("\nDry run: no embedding calls, nothing written to Pinecone.")
        return
    if input(f"\nRebuild namespace '{EXPERIMENT_NAMESPACE}' now? [y/N] ").strip().lower() != "y":
        print("Aborted.")
        return

    pinecone_index = Pinecone(api_key = settings.PINECONE_API_KEY).Index(settings.PINECONE_INDEX)
    before = namespace_counts(pinecone_index)

    store = ExperimentPineconeStore(pinecone_index, settings.PINECONE_INDEX, settings.ENVIRONMENT)
    store.clear()
    VectorStoreIndex(
        nodes,
        storage_context = StorageContext.from_defaults(vector_store = store),
        embed_model = OpenAIEmbedding(model = EMBED_MODEL, api_key = settings.OPENAI_API_KEY),
        show_progress = True,
    )

    # Pinecone stats lag behind writes by a few seconds.
    after = namespace_counts(pinecone_index)
    for _ in range(15):
        if after.get(EXPERIMENT_NAMESPACE, 0) == len(nodes):
            break
        time.sleep(2)
        after = namespace_counts(pinecone_index)

    print("\nPinecone namespace counts (before -> after):")
    for name in sorted(set(before) | set(after)):
        print(f"  {name:20} {before.get(name, 0):>6} -> {after.get(name, 0):>6}")


if __name__ == "__main__":
    main()
