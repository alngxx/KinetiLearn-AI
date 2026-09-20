import { useQuery } from "@tanstack/react-query"
import {
  getChatSession,
  listChatMessages,
  listChatSessions,
  type StoredChatMessage,
} from "@/modules/chat/api"
import type { ChatMessage } from "@/modules/chat/useChatTurns"

// classId narrows the list to one class's sessions — the study page's
// "Resume studying" check. Keyed so invalidateQueries(["chat-sessions"]) after
// a turn still matches every variant, scoped or not (React Query treats a key
// as a prefix match by default).
export function useChatSessions(classId?: string) {
  return useQuery({
    queryKey: ["chat-sessions", classId ?? null],
    queryFn: () => listChatSessions(classId),
  })
}

// Gated rather than always on: the panel starts closed on every page load, and
// a conversation nobody opened does not need fetching. Same enabled-gating
// idiom submissions/queries.ts uses for an id that arrives late.
export function useChatMessages(sessionId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["chat-messages", sessionId],
    queryFn: () => listChatMessages(sessionId as string),
    enabled: enabled && sessionId !== null,
  })
}

// The restored session's own scope, read from the server rather than trusted
// from whatever localStorage or a click handler last set — so the panel's
// scope chip can never drift from what the session actually is.
export function useChatSession(sessionId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["chat-session", sessionId],
    queryFn: () => getChatSession(sessionId as string),
    enabled: enabled && sessionId !== null,
  })
}

// A stored message is always finished: it only exists because _persist_turn
// committed it after the stream closed. Server ids are UUIDs, so they cannot
// collide with the m1, m2… ids useChatTurns hands to live turns.
export function toChatMessage(row: StoredChatMessage): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: row.citations,
    status: "done",
    error: null,
  }
}
