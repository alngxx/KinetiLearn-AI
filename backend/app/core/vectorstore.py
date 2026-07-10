from uuid import UUID

import chromadb

from app.core.config import settings

COLLECTION_NAME = "document_chunks"

_client = chromadb.PersistentClient(path = settings.CHROMA_PATH)


def get_collection():
    return _client.get_or_create_collection(COLLECTION_NAME)


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


def delete_version(document_id: UUID, version_number: int) -> None:
    get_collection().delete(
        where = {
            "$and": [
                {"document_id": {"$eq": str(document_id)}},
                {"version_number": {"$eq": version_number}},
            ]
        }
    )
