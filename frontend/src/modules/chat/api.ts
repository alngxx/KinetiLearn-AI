import { api } from "@/lib/apiClient"
import { streamSSE, type Citation, type DonePayload } from "@/lib/sseClient"
import type { components } from "@/types/api"

export type ChatSession = components["schemas"]["ChatSessionResponse"]
export type StoredChatMessage = components["schemas"]["ChatMessageResponse"]

// No body opens an unscoped chat over the whole corpus. classId scopes it to
// one class instead — mutually exclusive with a document scope server-side.
// The signal is passed through so Stop can interrupt this call too — without
// it Stop looks live but does nothing until the POST resolves on its own, and
// the answer starts anyway.
export function createChatSession(signal: AbortSignal, classId?: string) {
  const body = classId === undefined ? undefined : { class_id: classId }
  return api.post<ChatSession>("/api/v1/chat/sessions", body, { signal })
}

// The learner's own general chats, newest first. Explain sessions are not
// included — the server leaves them out, see chat/service.py list_sessions.
// classId narrows this to one class's sessions, for the study page's
// "Resume studying" check.
export function listChatSessions(classId?: string) {
  const query = classId === undefined ? "" : `?class_id=${classId}`
  return api.get<ChatSession[]>(`/api/v1/chat/sessions${query}`)
}

// Reads back a session's own scope — what the panel's chip renders from,
// rather than trusting a client-held id which could drift from the server.
export function getChatSession(sessionId: string) {
  return api.get<ChatSession>(`/api/v1/chat/sessions/${sessionId}`)
}

// The full transcript, oldest first, with the same citation shape the done
// frame carries — so a restored answer renders exactly like a streamed one.
export function listChatMessages(sessionId: string) {
  return api.get<StoredChatMessage[]>(`/api/v1/chat/sessions/${sessionId}/messages`)
}

export function streamChatMessage(
  sessionId: string,
  content: string,
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<DonePayload> {
  return streamSSE("/api/v1/chat/messages", { session_id: sessionId, content }, { onToken, signal })
}

// The whole request: chat/schemas.py's ExplainRequest is submission_id and
// nothing else. Which questions get explained is the server's call — it takes
// every answer that is not correct, skipped ones included, capped at ten.
// This is also what creates the session, so its id arrives in the done frame
// rather than beforehand.
export function streamExplain(
  submissionId: string,
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<DonePayload> {
  return streamSSE("/api/v1/chat/explain", { submission_id: submissionId }, { onToken, signal })
}

export type { Citation }
