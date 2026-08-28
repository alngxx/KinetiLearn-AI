import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  clearStoredChatSession,
  getStoredChatSession,
  setStoredChatSession,
} from "@/lib/chatSessionStorage"
import { isApiError } from "@/lib/errors"
import { createChatSession, streamChatMessage } from "@/modules/chat/api"
import { toChatMessage, useChatMessages } from "@/modules/chat/queries"
import { useChatTurns, type ChatMessage, type ChatStatus } from "@/modules/chat/useChatTurns"

export type { ChatMessage, ChatStatus }

// The conversation survives a reload: the id of the last one is kept in
// localStorage and its transcript is read back from GET /chat/sessions/{id}/
// messages when the panel is first opened. What is *not* restored is the panel
// itself — it always boots closed, the same call Task 38 made.
//
// `open` gates the restore fetch, so a learner who never opens the panel never
// pays for it. React Query caches the result, so reopening is free.
export function useChat(open: boolean) {
  const { messages, status, busy, stop, reset, runTurn } = useChatTurns()
  const queryClient = useQueryClient()

  // Both, and deliberately: the ref is read synchronously inside send, where
  // two calls in one tick would otherwise each create a session and split the
  // conversation; the state is what the query key and the composer gate need,
  // and only state brings a render with it. selectSession writes them together.
  const sessionRef = useRef<string | null>(getStoredChatSession())
  const [sessionId, setSessionId] = useState<string | null>(sessionRef.current)

  // The session whose transcript is already on screen. State rather than a ref
  // because whether the composer exists depends on it.
  const [seeded, setSeeded] = useState<string | null>(null)

  // Not fetched once seeded: the transcript has been applied and the live turns
  // added since are not in it. This also keeps a session that send() just
  // created from fetching its own empty transcript.
  const history = useChatMessages(sessionId, open && seeded !== sessionId)

  // A stored id the server will not return is a session that was deleted, or
  // one belonging to a learner who signed out on this browser. That is not an
  // error worth showing — it is handled below by starting clean — so it is
  // kept out of the failure state the panel renders.
  const restoreGone =
    history.isError && isApiError(history.error) && history.error.status === 404
  const restoreFailed = history.isError && !restoreGone

  const selectSession = useCallback((next: string | null) => {
    sessionRef.current = next
    setSessionId(next)
    if (next === null) clearStoredChatSession()
    else setStoredChatSession(next)
  }, [])

  // Restoring means: there is a session to read back and its transcript has not
  // been applied yet. Until that settles the conversation on screen is not the
  // real one, so nothing may be sent into it — see the composer gate in
  // ChatPanel, and the guard in send below.
  const restoring = sessionId !== null && seeded !== sessionId && !restoreFailed

  // Once per session id. Running again would wipe the turns added since, which
  // are not in this response — the server only has what it has committed.
  useEffect(() => {
    if (sessionId === null || history.data === undefined) return
    if (seeded === sessionId) return
    setSeeded(sessionId)
    reset(history.data.map(toChatMessage))
  }, [sessionId, seeded, history.data, reset])

  useEffect(() => {
    if (!restoreGone) return
    selectSession(null)
    setSeeded(null)
    reset()
  }, [restoreGone, selectSession, reset])

  const send = useCallback(
    async (raw: string) => {
      const content = raw.trim()
      if (content === "" || restoring) return
      await runTurn({
        userBubble: content,
        stream: async (onToken, signal) => {
          if (sessionRef.current === null) {
            const created = await createChatSession(signal)
            selectSession(created.id)
            // Marked seeded up front: its own transcript fetch would resolve
            // empty and reset() the turn that is streaming into it right now.
            setSeeded(created.id)
          }
          return streamChatMessage(sessionRef.current as string, content, onToken, signal)
        },
      })
      // The list is ordered by updated_at and titled from the first question,
      // so a finished turn changes it either way.
      void queryClient.invalidateQueries({ queryKey: ["chat-sessions"] })
    },
    [runTurn, restoring, selectSession, queryClient],
  )

  const openSession = useCallback(
    (id: string) => {
      if (id === sessionId) return
      // Whatever is streaming belongs to the conversation being left. Aborting
      // it means the server never persists that turn — _persist_turn runs after
      // the token loop — so it is gone from both ends, exactly as Stop leaves it.
      reset()
      setSeeded(null)
      selectSession(id)
    },
    [sessionId, reset, selectSession],
  )

  // Explicit, because with persistence "start again" no longer falls out of a
  // reload. No session is created here: the next send takes the lazy path
  // above, so a fresh chat nobody types in leaves no row behind.
  const newChat = useCallback(() => {
    reset()
    setSeeded(null)
    selectSession(null)
  }, [reset, selectSession])

  return {
    messages,
    status,
    busy,
    sessionId,
    restoring,
    restoreError: restoreFailed ? history.error : null,
    retryRestore: () => void history.refetch(),
    retryingRestore: history.isFetching,
    send,
    stop,
    openSession,
    newChat,
  }
}
