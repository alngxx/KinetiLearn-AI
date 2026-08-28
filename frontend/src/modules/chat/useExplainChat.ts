import { useCallback, useState } from "react"
import { streamChatMessage, streamExplain } from "@/modules/chat/api"
import { useChatTurns } from "@/modules/chat/useChatTurns"

// The explain conversation cannot go through useChat, and not for a cosmetic
// reason: its first turn is POST /chat/explain, which creates the session
// server-side and only hands back the id in the done frame. There is no session
// to pre-set and no question to open with — the learner pressed a button. Every
// turn after it is an ordinary message on the id that stream returned.
export function useExplainChat(submissionId: string) {
  const { messages, status, busy, stop, runTurn } = useChatTurns()
  // State, not a ref: the composer only appears once there is a session to send
  // on, so the id has to bring a render with it.
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  const start = useCallback(async () => {
    // One-shot on success: a failed explanation is retried through this same
    // path, but a finished one must not be asked for twice — that would open a
    // second session and strand the follow-ups on the first.
    if (sessionId !== null) return
    setStarted(true)
    const done = await runTurn({
      userBubble: null,
      stream: (onToken, signal) => streamExplain(submissionId, onToken, signal),
    })
    if (done !== null) setSessionId(done.session_id)
  }, [runTurn, sessionId, submissionId])

  const send = useCallback(
    async (raw: string) => {
      const content = raw.trim()
      // No session means the explanation never finished, so there is nothing to
      // follow up on.
      if (content === "" || sessionId === null) return
      await runTurn({
        userBubble: content,
        stream: (onToken, signal) => streamChatMessage(sessionId, content, onToken, signal),
      })
    },
    [runTurn, sessionId],
  )

  return { messages, status, busy, started, canFollowUp: sessionId !== null, start, send, stop }
}
