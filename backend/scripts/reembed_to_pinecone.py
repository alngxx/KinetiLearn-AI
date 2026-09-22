"""Re-embed every chunk in Postgres and upsert it into Pinecone.

A one-off: no embeddings are stored anywhere outside the active vector store, only
chunk text (DocumentChunk.content) and a pre-computed token_count. Switching an
environment from Chroma to Pinecone means re-embedding every chunk from that text
via OpenAI and upserting into the Pinecone index - there is nothing to copy.

Idempotent by construction, not by a skip-if-present check: each (document_id,
version_number) group is deleted from Pinecone before its chunks are re-upserted,
mirroring the "clean slate" pattern process_document already uses before Chroma
ingestion (worker/tasks.py). This also closes a gap a plain upsert-by-id would
leave open: if a version now has fewer chunks than a previous run left in the
index, the extra old vector_ids (higher chunk_index) would never get overwritten
and would linger as stale, still-matchable vectors. Re-running this script from
scratch at any time is safe.

Run from backend/ with the venv active:  python -m scripts.reembed_to_pinecone
"""
import asyncio
import itertools

from sqlalchemy import select

from app.core.database import SessionLocal

# The models reference each other by name, so the mapper cannot configure itself
# until every module is loaded — the same list, for the same reason, as
# alembic/env.py and scripts/backfill_document_classes.py.
import app.modules.config.models  # noqa: F401
import app.modules.auth.models  # noqa: F401
import app.modules.documents.models  # noqa: F401
import app.modules.classes.models  # noqa: F401
import app.modules.exams.models  # noqa: F401
import app.modules.scoring.models  # noqa: F401
import app.modules.quiz.models  # noqa: F401
import app.modules.chat.models  # noqa: F401

from app.core import pinecone_backend
from app.modules.documents.models import Document, DocumentChunk
from worker.processing import EMBED_MODEL, embed_texts

# text-embedding-3-small pricing, per 1M input tokens.
EMBED_PRICE_PER_1M_TOKENS = 0.02


async def main():
    async with SessionLocal() as db:
        result = await db.execute(
            select(DocumentChunk, Document.title)
            .join(Document, Document.id == DocumentChunk.document_id)
            .order_by(
                DocumentChunk.document_id,
                DocumentChunk.version_number,
                DocumentChunk.chunk_index,
            )
        )
        rows = result.all()

    if not rows:
        print("No chunks found — nothing to re-embed.")
        return

    print(f"Re-embedding {len(rows)} chunks into Pinecone (model: {EMBED_MODEL}):")

    total_chunks = 0
    total_versions = 0
    total_tokens = 0

    # Rows are already ordered by (document_id, version_number, chunk_index), so a
    # plain groupby splits them into per-version batches without re-sorting.
    for (document_id, version_number), group in itertools.groupby(
        rows, key = lambda row: (row[0].document_id, row[0].version_number)
    ):
        version_rows = list(group)
        title = version_rows[0][1]
        chunks = [
            {
                "index": chunk.chunk_index,
                "content": chunk.content,
                "token_count": chunk.token_count,
            }
            for chunk, _ in version_rows
        ]

        # Clean slate for this version before upserting — see module docstring.
        pinecone_backend.delete_version(document_id, version_number)

        embeddings = embed_texts([c["content"] for c in chunks])
        pinecone_backend.add_chunks(document_id, version_number, chunks, embeddings)

        version_tokens = sum(c["token_count"] or 0 for c in chunks)
        total_chunks += len(chunks)
        total_versions += 1
        total_tokens += version_tokens

        print(
            f"  {title}  v{version_number}  "
            f"({len(chunks)} chunks, {version_tokens} tokens)"
        )

    cost = total_tokens / 1_000_000 * EMBED_PRICE_PER_1M_TOKENS
    print(
        f"\nDone: {total_chunks} chunks across {total_versions} document versions, "
        f"{total_tokens} tokens embedded, ≈${cost:.4f} at "
        f"${EMBED_PRICE_PER_1M_TOKENS}/1M tokens."
    )


if __name__ == "__main__":
    asyncio.run(main())
