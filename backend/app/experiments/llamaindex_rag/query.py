import time

from llama_index.core import VectorStoreIndex
from llama_index.core.prompts import ChatPromptTemplate
from llama_index.embeddings.openai import OpenAIEmbedding
from pinecone import Pinecone

from app.core.config import settings
from app.core.llm import CHAT_SYSTEM_PROMPT, EMBED_MODEL
from app.experiments.llamaindex_rag.llm import ExperimentChatLLM
from app.experiments.llamaindex_rag.pinecone_store import ExperimentPineconeStore
from app.experiments.llamaindex_rag.result import Citation, RagResult
from app.modules.chat.service import MIN_SIMILARITY, NO_MATCH_ANSWER, TOP_K

# The same system prompt and user-message layout as ChatService._build_prompt.
QA_TEMPLATE = ChatPromptTemplate.from_messages([
    ("system", CHAT_SYSTEM_PROMPT),
    ("user", "Source excerpts:\n{context_str}\n\nQuestion: {query_str}"),
])

_index: VectorStoreIndex | None = None
_llm: ExperimentChatLLM | None = None


def get_index() -> VectorStoreIndex:
    global _index
    if _index is None:
        pinecone_index = Pinecone(api_key = settings.PINECONE_API_KEY).Index(settings.PINECONE_INDEX)
        store = ExperimentPineconeStore(pinecone_index, settings.PINECONE_INDEX, settings.ENVIRONMENT)
        _index = VectorStoreIndex.from_vector_store(
            store,
            embed_model = OpenAIEmbedding(model = EMBED_MODEL, api_key = settings.OPENAI_API_KEY),
        )
    return _index


def get_llm() -> ExperimentChatLLM:
    global _llm
    if _llm is None:
        _llm = ExperimentChatLLM()
    return _llm


def format_context(hits: list) -> str:
    return "\n\n".join(
        f'[Source {i}] from "{hit.node.metadata["title"]}", '
        f'chunk {hit.node.metadata["chunk_index"]}:\n{hit.node.get_content()}'
        for i, hit in enumerate(hits, start = 1)
    )


def answer_llamaindex(
    question: str,
    top_k: int = TOP_K,
    min_similarity: float = MIN_SIMILARITY,
    index: VectorStoreIndex | None = None,
    llm: ExperimentChatLLM | None = None,
) -> RagResult:
    """Answer one question from the llamaindex-exp namespace.

    Takes the same inputs and returns the same RagResult as
    baseline.answer_current. Like production, it returns the canned answer
    only when the best chunk scores below min_similarity; otherwise it sends
    every retrieved chunk. LlamaIndex's SimilarityPostprocessor would instead
    drop each chunk under the cutoff, which is a different rule.
    """
    index = index or get_index()
    llm = llm or get_llm()
    started = time.monotonic()

    hits = index.as_retriever(similarity_top_k = top_k).retrieve(question)
    citations = [
        Citation(
            document_id = hit.node.metadata["document_id"],
            document_title = hit.node.metadata["title"],
            chunk_index = hit.node.metadata["chunk_index"],
            relevance_score = hit.score or 0.0,
            content = hit.node.get_content(),
        )
        for hit in hits
    ]

    best_similarity = hits[0].score if hits else 0.0
    if best_similarity < min_similarity:
        return RagResult(
            answer = NO_MATCH_ANSWER,
            citations = citations,
            no_match = True,
            latency_ms = int((time.monotonic() - started) * 1000),
        )

    messages = QA_TEMPLATE.format_messages(
        context_str = format_context(hits), query_str = question
    )
    response = llm.chat(messages)
    usage = response.raw.usage
    return RagResult(
        answer = response.message.content,
        citations = citations,
        prompt_tokens = usage.prompt_tokens,
        completion_tokens = usage.completion_tokens,
        total_tokens = usage.total_tokens,
        latency_ms = int((time.monotonic() - started) * 1000),
        model = llm.model,
    )
