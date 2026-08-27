import { useCallback, useRef, useState } from "react"
import { isApiError } from "@/lib/errors"
import { createChatSession, streamChatMessage, type Citation } from "@/modules/chat/api"

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

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>("idle")
  const [busy, setBusy] = useState(false)

  // There is no GET /chat/sessions, so this id is the whole conversation. It
  // lives in memory only: a reload starts a new one, which is all the API
  // supports.
  const sessionRef = useRef<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  // Checked and set synchronously, unlike the busy state below. Two sends in one
  // batch would both see busy === false and each create a session, splitting the
  // conversation across two of them with no way to merge it.
  const busyRef = useRef(false)
  const idRef = useRef(0)

  function nextId() {
    idRef.current += 1
    return `m${idRef.current}`
  }

  const stop = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const send = useCallback(async (raw: string) => {
    const content = raw.trim()
    if (content === "" || busyRef.current) return
    busyRef.current = true
    setBusy(true)

    // Created before the session call, not after, so Stop interrupts whichever
    // of the two requests is in flight.
    const controller = new AbortController()
    controllerRef.current = controller

    const assistantId = nextId()
    setMessages((current) => [
      ...current,
      {
        id: nextId(),
        role: "user",
        content,
        citations: [],
        status: "done",
        error: null,
      },
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
      if (sessionRef.current === null) {
        sessionRef.current = (await createChatSession(controller.signal)).id
      }
      const done = await streamChatMessage(
        sessionRef.current,
        content,
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
      patch({ citations: done.citations, status: "done" })
      setStatus("ready")
    } catch (err) {
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
    } finally {
      busyRef.current = false
      setBusy(false)
      controllerRef.current = null
    }
  }, [])

  return { messages, status, busy, send, stop }
}
