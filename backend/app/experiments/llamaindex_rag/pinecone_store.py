from typing import Any, Sequence

from llama_index.core.schema import BaseNode, TextNode
from llama_index.core.vector_stores.types import (
    BasePydanticVectorStore,
    VectorStoreQuery,
    VectorStoreQueryResult,
)
from pinecone.errors.exceptions import NotFoundError
from pydantic import PrivateAttr

from app.experiments.llamaindex_rag.guard import EXPERIMENT_NAMESPACE, check_safe_target

UPSERT_BATCH_SIZE = 100


class ExperimentPineconeStore(BasePydanticVectorStore):
    """LlamaIndex vector store bound to the experiment's Pinecone namespace.

    Replaces llama-index-vector-stores-pinecone, which requires pinecone<10.
    Every call passes the namespace explicitly, because Pinecone's default
    is the namespace that holds production vectors.
    """

    # The chunk text travels in Pinecone metadata, so LlamaIndex needs no
    # separate docstore to rebuild nodes from query results.
    stores_text: bool = True
    _index: Any = PrivateAttr()

    def __init__(self, pinecone_index: Any, index_name: str, environment: str):
        check_safe_target(index_name, EXPERIMENT_NAMESPACE, environment)
        super().__init__()
        self._index = pinecone_index

    @property
    def client(self) -> Any:
        return self._index

    def add(self, nodes: Sequence[BaseNode], **kwargs: Any) -> list[str]:
        vectors = []
        for node in nodes:
            metadata = dict(node.metadata)
            metadata["text"] = node.get_content()
            metadata["ref_doc_id"] = node.ref_doc_id or ""
            vectors.append({
                "id": node.node_id,
                "values": node.get_embedding(),
                "metadata": metadata,
            })
        # One request holding every vector exceeds Pinecone's 4 MB limit.
        self._index.upsert(
            vectors = vectors,
            namespace = EXPERIMENT_NAMESPACE,
            batch_size = UPSERT_BATCH_SIZE,
            show_progress = False,
        )
        return [node.node_id for node in nodes]

    def delete(self, ref_doc_id: str, **kwargs: Any) -> None:
        self._index.delete(
            filter = {"ref_doc_id": {"$eq": ref_doc_id}}, namespace = EXPERIMENT_NAMESPACE
        )

    def clear(self) -> None:
        try:
            self._index.delete(delete_all = True, namespace = EXPERIMENT_NAMESPACE)
        except NotFoundError:
            # The namespace does not exist until the first upsert.
            pass

    def query(self, query: VectorStoreQuery, **kwargs: Any) -> VectorStoreQueryResult:
        if query.filters is not None:
            raise NotImplementedError("Metadata filters are not supported by this store.")

        result = self._index.query(
            vector = query.query_embedding,
            top_k = query.similarity_top_k,
            namespace = EXPERIMENT_NAMESPACE,
            include_metadata = True,
        )
        nodes = []
        similarities = []
        ids = []
        for match in result.matches:
            metadata = dict(match.metadata or {})
            text = metadata.pop("text", "")
            metadata.pop("ref_doc_id", None)
            nodes.append(TextNode(id_ = match.id, text = text, metadata = metadata))
            # Clamped like app.core.pinecone_backend.search.
            similarities.append(min(1.0, max(0.0, match.score)))
            ids.append(match.id)
        return VectorStoreQueryResult(nodes = nodes, similarities = similarities, ids = ids)
