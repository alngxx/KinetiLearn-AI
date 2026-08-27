import { act, renderHook, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useChat } from "@/modules/chat/useChat"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// A stream the test drives frame by frame, so a send can be caught mid-answer.
function controllableStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    stream,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useChat", () => {
  let sessionCalls: number
  let sessionAborted: boolean
  let releaseSession: () => void
  let sessionGate: Promise<void>
  let stream: ReturnType<typeof controllableStream>

  beforeEach(() => {
    sessionCalls = 0
    sessionAborted = false
    sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve
    })
    stream = controllableStream()

    server.use(
      http.post(`${API}/api/v1/chat/sessions`, async ({ request }) => {
        sessionCalls += 1
        request.signal.addEventListener("abort", () => {
          sessionAborted = true
        })
        await sessionGate
        return HttpResponse.json(
          {
            id: "s1",
            exercise_id: null,
            document_id: null,
            title: null,
            is_active: true,
            created_at: "2026-08-27T09:00:00Z",
            updated_at: "2026-08-27T09:00:00Z",
          },
          { status: 201 },
        )
      }),
      http.post(
        `${API}/api/v1/chat/messages`,
        () =>
          new HttpResponse(stream.stream, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      ),
    )
  })

  // Two sends in the same tick both see sessionId === null. Without a guard read
  // synchronously, each creates a session and the conversation is split across
  // two of them with no way to merge it. A useState flag cannot catch this: it
  // is not applied until React re-renders.
  it("creates one session when two sends fire in the same tick", async () => {
    const { result } = renderHook(() => useChat())

    await act(async () => {
      void result.current.send("first")
      void result.current.send("second")
    })

    releaseSession()
    stream.push(frame("token", { content: "hello" }))
    stream.push(
      frame("done", { session_id: "s1", message_id: "m1", citations: [] }),
    )
    stream.close()

    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(sessionCalls).toBe(1)
    // The second send was dropped, not queued behind the first.
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1)
  })

  // Stop has to reach the session call too. Wired only to the stream, it would
  // look live during this window and do nothing, and the answer would arrive
  // anyway once the POST resolved.
  it("aborts a pending session creation and clears busy immediately", async () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      void result.current.send("hi")
    })
    await waitFor(() => expect(result.current.busy).toBe(true))

    act(() => {
      result.current.stop()
    })

    // Asserted before the gate opens: a version that only unblocks when the
    // session POST resolves on its own fails here.
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(sessionAborted).toBe(true)
    expect(result.current.status).toBe("stopped")

    // The question stays; the answer that never started does not.
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].role).toBe("user")

    releaseSession()
  })

  // Stubs fetch rather than going through msw. msw's Node interceptor leaves a
  // pending read() hanging when the client aborts, so the loop never wakes and
  // the test would time out on a mechanism that works in a browser. A real
  // fetch errors the body stream on abort, which is what this reproduces —
  // the same approach sseClient.test.ts uses for its own abort test.
  it("keeps the partial answer when stopped mid-stream", async () => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/chat/sessions")) {
          return new Response(JSON.stringify({ id: "s1" }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          })
        }
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            bodyController = controller
            init.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("The operation was aborted.", "AbortError")),
            )
          },
        })
        return new Response(body, { status: 200 })
      }),
    )

    const { result } = renderHook(() => useChat())
    act(() => {
      void result.current.send("hi")
    })

    await waitFor(() => expect(bodyController).toBeDefined())
    act(() => {
      bodyController.enqueue(encoder.encode(frame("token", { content: "Compliance " })))
      bodyController.enqueue(encoder.encode(frame("token", { content: "training " })))
    })
    await waitFor(() =>
      expect(result.current.messages[1].content).toBe("Compliance training "),
    )

    act(() => {
      result.current.stop()
    })

    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.messages[1].content).toBe("Compliance training ")
    expect(result.current.messages[1].status).toBe("stopped")
    expect(result.current.status).toBe("stopped")
  })

  it("reuses the session for the second message", async () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      void result.current.send("first")
    })
    releaseSession()
    stream.push(frame("token", { content: "one" }))
    stream.push(frame("done", { session_id: "s1", message_id: "m1", citations: [] }))
    stream.close()
    await waitFor(() => expect(result.current.busy).toBe(false))

    stream = controllableStream()
    act(() => {
      void result.current.send("second")
    })
    stream.push(frame("token", { content: "two" }))
    stream.push(frame("done", { session_id: "s1", message_id: "m2", citations: [] }))
    stream.close()
    await waitFor(() => expect(result.current.busy).toBe(false))

    expect(sessionCalls).toBe(1)
  })

  it("marks the message failed on a mid-stream error frame, keeping what arrived", async () => {
    const { result } = renderHook(() => useChat())

    act(() => {
      void result.current.send("hi")
    })
    releaseSession()
    stream.push(frame("token", { content: "Compliance " }))
    stream.push(frame("error", { detail: "Failed to generate a response" }))
    stream.close()

    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(result.current.status).toBe("failed")
    expect(result.current.messages[1].content).toBe("Compliance ")
    expect(result.current.messages[1].error).toBe("Failed to generate a response")
  })

  it("ignores an empty send", async () => {
    const { result } = renderHook(() => useChat())

    await act(async () => {
      void result.current.send("   ")
    })

    expect(sessionCalls).toBe(0)
    expect(result.current.messages).toHaveLength(0)
  })
})
