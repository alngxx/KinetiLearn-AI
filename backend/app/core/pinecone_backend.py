from uuid import UUID

from pinecone import Pinecone, Vector
from pinecone.errors.exceptions import NotFoundError

from app.core.config import settings

# Built on first use, not at import — same reasoning as chroma_backend's lazy
# client: Celery's prefork pool imports this module in the parent process and
# then forks. A client built pre-fork would carry pooled HTTP connections the
# child inherits and shares with the parent, which can corrupt or hang requests
# under concurrent workers. Chroma's version of this is a native mmap segfault;
# this one is a socket-sharing hazard instead, but the fix is the same: build it
# lazily so each process gets its own client after forking.
_client = None
_index = None


def _get_index():
    global _client, _index
    if _index is None:
        if not settings.PINECONE_API_KEY or not settings.PINECONE_INDEX:
            raise RuntimeError(
                "VECTOR_STORE_BACKEND=pinecone requires PINECONE_API_KEY and "
                "PINECONE_INDEX to be set."
            )
        _client = Pinecone(api_key = settings.PINECONE_API_KEY)
        _index = _client.Index(settings.PINECONE_INDEX)
    return _index


def vector_id(document_id: UUID, version_number: int, chunk_index: int) -> str:
    return f"{document_id}:{version_number}:{chunk_index}"


def add_chunks(
    document_id: UUID,
    version_number: int,
    chunks: list[dict],
    embeddings: list[list[float]],
) -> list[str]:
    ids = [vector_id(document_id, version_number, c["index"]) for c in chunks]
    vectors = [
        Vector(
            id = vid,
            values = embedding,
            metadata = {
                "document_id": str(document_id),
                "version_number": version_number,
                "chunk_index": c["index"],
            },
        )
        for vid, c, embedding in zip(ids, chunks, embeddings)
    ]
    _get_index().upsert(vectors = vectors)
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
    # Same guard as Chroma's _scope_filter: a single eligible document passes its
    # $and through on its own rather than assuming Pinecone tolerates or requires
    # a one-element $or.
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

    result = _get_index().query(
        vector = query_embedding,
        top_k = top_k,
        filter = _scope_filter(scope),
        include_metadata = False,
    )

    # Pinecone returns a native cosine score when the index metric is "cosine" -
    # no L2-to-cosine conversion here, unlike Chroma's search(). Clamped the same
    # way for a consistent return shape between backends.
    hits = []
    for match in result.matches:
        hits.append({
            "vector_id": match.id,
            "similarity": min(1.0, max(0.0, match.score)),
        })
    return hits


def _delete_by_filter(filter: dict) -> None:
    try:
        _get_index().delete(filter = filter)
    except NotFoundError:
        # A namespace only exists once something has been upserted into it, so a
        # filter delete against a brand-new (or already-emptied) index 404s
        # instead of matching zero vectors. Chroma treats "delete what isn't
        # there" as a no-op; this makes Pinecone match that.
        pass


def delete_version(document_id: UUID, version_number: int) -> None:
    _delete_by_filter({
        "$and": [
            {"document_id": {"$eq": str(document_id)}},
            {"version_number": {"$eq": version_number}},
        ]
    })


def delete_document(document_id: UUID) -> None:
    # Every version at once — the metadata filter ignores version_number, so a
    # hard delete does not need to enumerate the versions first.
    _delete_by_filter({"document_id": {"$eq": str(document_id)}})
