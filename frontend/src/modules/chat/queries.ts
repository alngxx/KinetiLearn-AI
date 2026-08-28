import { useQuery } from "@tanstack/react-query"
import { listChatMessages, listChatSessions, type StoredChatMessage } from "@/modules/chat/api"
import type { ChatMessage } from "@/modules/chat/useChatTurns"

export function useChatSessions() {
  return useQuery({
    queryKey: ["chat-sessions"],
    queryFn: listChatSessions,
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
