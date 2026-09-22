from uuid import UUID

from app.core.config import settings

if settings.VECTOR_STORE_BACKEND == "chroma":
    from app.core import chroma_backend as _backend
elif settings.VECTOR_STORE_BACKEND == "pinecone":
    from app.core import pinecone_backend as _backend
else:
    raise RuntimeError(
        f"Unrecognized VECTOR_STORE_BACKEND: {settings.VECTOR_STORE_BACKEND!r} "
        "(expected 'chroma' or 'pinecone')"
    )


def add_chunks(
    document_id: UUID,
    version_number: int,
    chunks: list[dict],
    embeddings: list[list[float]],
) -> list[str]:
    return _backend.add_chunks(document_id, version_number, chunks, embeddings)


def search(
    query_embedding: list[float],
    scope: list[tuple[UUID, int]],
    top_k: int,
) -> list[dict]:
    return _backend.search(query_embedding, scope, top_k)


def delete_version(document_id: UUID, version_number: int) -> None:
    return _backend.delete_version(document_id, version_number)


def delete_document(document_id: UUID) -> None:
    return _backend.delete_document(document_id)
