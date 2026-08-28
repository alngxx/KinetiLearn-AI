import { useCallback, useRef, useState } from "react"
import { isApiError } from "@/lib/errors"
import type { Citation, DonePayload } from "@/lib/sseClient"

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  citations: Citation[]
  status: "streaming" | "done" | "stopped" | "failed"
  error: string | null
}

// Drives the panel's live region. The streaming text itself is not announced —
// token by token it is unusable with a screen reader — so this is the only
// thing that reports what happened, including a stream that failed.
export type ChatStatus = "idle" | "answering" | "ready" | "stopped" | "failed"

export type ChatTurn = {
  // The bubble to show for what was asked. null for a turn nobody typed: the
  // explain stream opens itself off a button, with no question to echo back.
  userBubble: string | null
  stream: (onToken: (token: string) => void, signal: AbortSignal) => Promise<DonePayload>
}

// The half both conversations share: optimistic bubbles, token appending, the
// AbortController behind Stop, and the stopped-vs-failed decision. What differs
// between them is only which request opens the turn, which is why that is the
// caller's to pass in. useChat and useExplainChat are both thin wrappers here.
export function useChatTurns() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>("idle")
  const [busy, setBusy] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)
  // Checked and set synchronously, unlike the busy state below. Two sends in one
  // batch would both see busy === false and each create a session, splitting the
  // conversation across two of them with no way to merge it.
  const busyRef = useRef(false)
  const idRef = useRef(0)
  // Bumped by reset. A turn that was abandoned mid-flight must not write its
  // outcome over the conversation that replaced it — the abort below lands a
  // microtask later, by which time these messages belong to another session.
  const generationRef = useRef(0)

  function nextId() {
    idRef.current += 1
    return `m${idRef.current}`
  }

  const stop = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  // Swaps the conversation out: used when a different session is opened and
  // when a restored transcript arrives. Aborting is the point, not cleanup —
  // whatever was streaming belonged to the conversation being left.
  const reset = useCallback((initial: ChatMessage[] = []) => {
    generationRef.current += 1
    controllerRef.current?.abort()
    setMessages(initial)
    setStatus("idle")
  }, [])

  // Resolves to the done payload so a caller can keep what the stream told it —
  // useExplainChat needs the session_id from it, since /chat/explain is what
  // creates the session. null means the turn was refused, stopped, or failed.
  const runTurn = useCallback(async (turn: ChatTurn): Promise<DonePayload | null> => {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(true)

    // Created before the first request, not after, so Stop interrupts whichever
    // of the calls in a turn is in flight.
    const controller = new AbortController()
    controllerRef.current = controller
    const generation = generationRef.current

    const assistantId = nextId()
    const opening: ChatMessage[] =
      turn.userBubble === null
        ? []
        : [
            {
              id: nextId(),
              role: "user",
              content: turn.userBubble,
              citations: [],
              status: "done",
              error: null,
            },
          ]
    setMessages((current) => [
      ...current,
      ...opening,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        citations: [],
        status: "streaming",
        error: null,
      },
    ])
    setStatus("answering")

    function patch(changes: Partial<ChatMessage>) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, ...changes } : message,
        ),
      )
    }

    try {
      const done = await turn.stream(
        (token) =>
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + token }
                : message,
            ),
          ),
        controller.signal,
      )
      if (generationRef.current !== generation) return null
      patch({ citations: done.citations, status: "done" })
      setStatus("ready")
      return done
    } catch (err) {
      // Reset already replaced these messages and the status, so there is
      // nothing left of this turn to mark up.
      if (generationRef.current !== generation) return null
      // The signal, not the error's shape: an aborted fetch surfaces as a
      // DOMException in the browser but not everywhere, and apiClient turns
      // anything it does not recognise into a plain network ApiError. Asking
      // the controller we own is the one answer that cannot be wrong.
      if (controller.signal.aborted) {
        // Stopping before any token arrived — most likely during session
        // creation — leaves an empty bubble with nothing to say, so it goes.
        // The question stays: they did ask it.
        // A stopped turn is never written server-side either: _persist_turn runs
        // after the token loop, so the partial answer kept here will not be in
        // the model's history for the next question.
        setMessages((current) =>
          current.flatMap((message) =>
            message.id !== assistantId
              ? [message]
              : message.content === ""
                ? []
                : [{ ...message, status: "stopped" as const }],
          ),
        )
        setStatus("stopped")
      } else {
        patch({
          status: "failed",
          error: isApiError(err) ? err.message : "Something went wrong. Please try again.",
        })
        setStatus("failed")
      }
      return null
    } finally {
      busyRef.current = false
      setBusy(false)
      controllerRef.current = null
    }
  }, [])

  return { messages, status, busy, stop, reset, runTurn }
}
