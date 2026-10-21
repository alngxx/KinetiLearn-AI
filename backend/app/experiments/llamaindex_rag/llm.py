from typing import Any, Sequence

from llama_index.core.llms import (
    ChatMessage,
    ChatResponse,
    CompletionResponse,
    CompletionResponseGen,
    CustomLLM,
    LLMMetadata,
)
from llama_index.core.llms.callbacks import llm_chat_callback, llm_completion_callback
from openai import OpenAI
from pydantic import PrivateAttr

from app.core.config import settings
from app.core.llm import CHAT_MODEL


class ExperimentChatLLM(CustomLLM):
    """LlamaIndex LLM that calls the chat model with the openai 3.x client.

    Replaces llama-index-llms-openai, which requires openai<3. Uses the same
    model and reasoning_effort as app.core.llm.stream_chat. The raw API
    response is kept on ChatResponse.raw so callers can read exact usage.
    """

    model: str = CHAT_MODEL
    _client: Any = PrivateAttr()

    def __init__(self, client: Any = None, **kwargs: Any):
        super().__init__(**kwargs)
        self._client = client or OpenAI(api_key = settings.OPENAI_API_KEY)

    @property
    def metadata(self) -> LLMMetadata:
        return LLMMetadata(model_name = self.model, is_chat_model = True)

    # CustomLLM's default chat() flattens all messages into one prompt string.
    # Production sends the system prompt as its own message, so this keeps
    # the roles.
    @llm_chat_callback()
    def chat(self, messages: Sequence[ChatMessage], **kwargs: Any) -> ChatResponse:
        completion = self._client.chat.completions.create(
            model = self.model,
            messages = [{"role": m.role.value, "content": m.content} for m in messages],
            reasoning_effort = "none",
        )
        return ChatResponse(
            message = ChatMessage(
                role = "assistant", content = completion.choices[0].message.content or ""
            ),
            raw = completion,
        )

    @llm_completion_callback()
    def complete(self, prompt: str, formatted: bool = False, **kwargs: Any) -> CompletionResponse:
        response = self.chat([ChatMessage(role = "user", content = prompt)])
        return CompletionResponse(text = response.message.content, raw = response.raw)

    @llm_completion_callback()
    def stream_complete(
        self, prompt: str, formatted: bool = False, **kwargs: Any
    ) -> CompletionResponseGen:
        raise NotImplementedError("The experiment does not stream.")
