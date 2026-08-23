from uuid import UUID

import chromadb

from app.core.config import settings

COLLECTION_NAME = "document_chunks"

# Built on first use, not at import. Celery's prefork pool imports this module in
# the parent process and then forks; a client created before the fork carries
# native state the child cannot use, which segfaults. Creating it lazily means
# each process opens its own client after forking.
_client = None


def _get_client():
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path = settings.CHROMA_PATH)
    return _client


def get_collection():
    return _get_client().get_or_create_collection(COLLECTION_NAME)


def vector_id(document_id: UUID, version_number: int, chunk_index: int) -> str:
    return f"{document_id}:{version_number}:{chunk_index}"


def add_chunks(
    document_id: UUID,
    version_number: int,
    chunks: list[dict],
    embeddings: list[list[float]],
) -> list[str]:
    ids = [vector_id(document_id, version_number, c["index"]) for c in chunks]
    metadatas = [
        {
            "document_id": str(document_id),
            "version_number": version_number,
            "chunk_index": c["index"],
        }
        for c in chunks
    ]
    documents = [c["content"] for c in chunks]
    get_collection().add(               
        ids = ids,
        embeddings = embeddings,    # type: ignore[arg-type]
        documents = documents,
        metadatas = metadatas,      # type: ignore[arg-type]
    )
    return ids


def _scope_filter(scope: list[tuple[UUID, int]]) -> dict:
    clauses = [
        {
            "$and": [
                {"document_id": {"$eq": str(document_id)}},
                {"version_number": {"$eq": version_number}},
            ]
        }
        for document_id, version_number in scope
    ]
    # Chroma rejects an $or holding fewer than two expressions, so a single
    # eligible document has to pass its $and through on its own.
    if len(clauses) == 1:
        return clauses[0]
    return {"$or": clauses}


def search(
    query_embedding: list[float],
    scope: list[tuple[UUID, int]],
    top_k: int,
) -> list[dict]:
    if not scope:
        return []

    result = get_collection().query(
        query_embeddings = [query_embedding],
        n_results = top_k,
        where = _scope_filter(scope),      # type: ignore[arg-type]
        include = ["distances"],           # type: ignore[list-item]
    )
    ids = result["ids"][0]
    distances = result["distances"][0]     # type: ignore[index]

    # The collection is built with hnsw space "l2", so these are squared L2
    # distances; the embeddings are unit vectors, so cos = 1 - d/2. Clamp to the
    # 0.0-1.0 range relevance_score documents: cosine can legitimately go
    # negative, while the upper bound is insurance only — a sum of squares can't
    # be negative, so it never fires today.
    hits = []
    for vid, distance in zip(ids, distances):
        similarity = 1.0 - distance / 2.0
        hits.append({
            "vector_id": vid,
            "similarity": min(1.0, max(0.0, similarity)),
        })
    return hits


def delete_version(document_id: UUID, version_number: int) -> None:
    get_collection().delete(
        where = {
            "$and": [
                {"document_id": {"$eq": str(document_id)}},
                {"version_number": {"$eq": version_number}},
            ]
        }
    )


def delete_document(document_id: UUID) -> None:
    # Every version at once — the metadata filter ignores version_number, so a
    # hard delete does not need to enumerate the versions first.
    get_collection().delete(
        where = {"document_id": {"$eq": str(document_id)}}
    )
