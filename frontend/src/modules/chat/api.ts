import { api } from "@/lib/apiClient"
import { streamSSE, type Citation, type DonePayload } from "@/lib/sseClient"
import type { components } from "@/types/api"

export type ChatSession = components["schemas"]["ChatSessionResponse"]

// No body opens an unscoped chat over the whole corpus. The signal is passed
// through so Stop can interrupt this call too — without it Stop looks live but
// does nothing until the POST resolves on its own, and the answer starts anyway.
export function createChatSession(signal: AbortSignal) {
  return api.post<ChatSession>("/api/v1/chat/sessions", undefined, { signal })
}

export function streamChatMessage(
  sessionId: string,
  content: string,
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<DonePayload> {
  return streamSSE("/api/v1/chat/messages", { session_id: sessionId, content }, { onToken, signal })
}

export type { Citation }
