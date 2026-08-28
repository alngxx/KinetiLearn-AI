import { useCallback, useRef } from "react"
import { createChatSession, streamChatMessage } from "@/modules/chat/api"
import { useChatTurns, type ChatMessage, type ChatStatus } from "@/modules/chat/useChatTurns"

export type { ChatMessage, ChatStatus }

export function useChat() {
  const { messages, status, busy, stop, runTurn } = useChatTurns()

  // There is no GET /chat/sessions, so this id is the whole conversation. It
  // lives in memory only: a reload starts a new one, which is all the API
  // supports.
  const sessionRef = useRef<string | null>(null)

  const send = useCallback(
    async (raw: string) => {
      const content = raw.trim()
      if (content === "") return
      await runTurn({
        userBubble: content,
        stream: async (onToken, signal) => {
          if (sessionRef.current === null) {
            sessionRef.current = (await createChatSession(signal)).id
          }
          return streamChatMessage(sessionRef.current, content, onToken, signal)
        },
      })
    },
    [runTurn],
  )

  return { messages, status, busy, send, stop }
}
