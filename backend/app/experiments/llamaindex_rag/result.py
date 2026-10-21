from dataclasses import asdict, dataclass, field


# Same fields as app.modules.chat.schemas.CitationResponse, minus the chunk's
# Postgres id, which LlamaIndex nodes do not have.
@dataclass
class Citation:
    document_id: str
    document_title: str
    chunk_index: int
    relevance_score: float
    content: str


# What both pipelines return for one question, so evaluate.py can score them
# with the same code.
@dataclass
class RagResult:
    answer: str
    citations: list[Citation] = field(default_factory = list)
    # True when retrieval fell below MIN_SIMILARITY and the canned answer was
    # returned without calling the LLM.
    no_match: bool = False
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    # The current pipeline only reports total_tokens; its prompt/completion
    # split is counted with tiktoken, so it is an estimate.
    tokens_estimated: bool = False
    latency_ms: int = 0
    model: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)
