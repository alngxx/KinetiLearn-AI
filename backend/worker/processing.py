from io import BytesIO

import fitz
import tiktoken
from docx import Document as DocxDocument
from langchain_text_splitters import RecursiveCharacterTextSplitter
from openai import OpenAI

from app.core.config import settings

EMBED_MODEL = "text-embedding-3-small"
CHUNK_TARGET_TOKENS = 500
CHUNK_OVERLAP_TOKENS = 50

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_encoding = tiktoken.encoding_for_model(EMBED_MODEL)

# Splits on paragraph -> line -> word -> character in that order, so chunks
# break on natural boundaries and only cut mid-sentence when a single block
# exceeds the target. Lengths are measured in tokens, not characters.
_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
    model_name = EMBED_MODEL,
    chunk_size = CHUNK_TARGET_TOKENS,
    chunk_overlap = CHUNK_OVERLAP_TOKENS,
)

_client = OpenAI(api_key = settings.OPENAI_API_KEY)


def extract_text(mime_type: str, data: bytes) -> str:
    if mime_type == PDF_MIME:
        doc = fitz.open(stream = data, filetype = "pdf")
        try:
            return "\n".join(page.get_text() for page in doc)       # type: ignore[attr-defined]
        finally:
            doc.close()
    if mime_type == DOCX_MIME:
        doc = DocxDocument(BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)
    raise ValueError(f"Unsupported mime type: {mime_type}")


def split_into_chunks(text: str) -> list[dict]:
    chunks = []
    for index, content in enumerate(_splitter.split_text(text)):
        chunks.append({
            "index": index,
            "content": content,
            "token_count": len(_encoding.encode(content)),
        })
    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    response = _client.embeddings.create(model = EMBED_MODEL, input = texts)
    return [item.embedding for item in response.data]
