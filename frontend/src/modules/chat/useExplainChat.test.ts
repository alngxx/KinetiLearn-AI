import { act, renderHook, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useExplainChat } from "@/modules/chat/useExplainChat"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// A stream the test drives frame by frame, so Stop can be pressed mid-answer.
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

function sseResponse(body: BodyInit) {
  return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useExplainChat", () => {
  let explainCalls: number
  let sessionCalls: number
  let stream: ReturnType<typeof controllableStream>

  beforeEach(() => {
    explainCalls = 0
    sessionCalls = 0
    stream = controllableStream()

    server.use(
      // The explain flow must never open a session of its own: POST
      // /chat/explain is what creates one, server-side.
      http.post(`${API}/api/v1/chat/sessions`, () => {
        sessionCalls += 1
        return HttpResponse.json({ id: "unwanted" })
      }),
      http.post(`${API}/api/v1/chat/explain`, () => {
        explainCalls += 1
        return sseResponse(stream.stream)
      }),
    )
  })

  it("opens with no bubble for a question nobody typed", async () => {
    const { result } = renderHook(() => useExplainChat("sub1"))

    act(() => void result.current.start())
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    expect(result.current.messages[0].role).toBe("assistant")
    expect(result.current.started).toBe(true)
    expect(sessionCalls).toBe(0)
  })

  it("keeps the session id from the done frame and follows up on it", async () => {
    let followUp: unknown = null
    server.use(
      http.post(`${API}/api/v1/chat/messages`, async ({ request }) => {
        followUp = await request.json()
        return sseResponse(
          frame("token", { content: "Because of the policy." }) +
            frame("done", { session_id: "sess1", message_id: "m2", citations: [] }),
        )
      }),
    )

    const { result } = renderHook(() => useExplainChat("sub1"))
    act(() => void result.current.start())

    // Nothing to follow up on until the stream has said which session it made.
    await waitFor(() => expect(result.current.busy).toBe(true))
    expect(result.current.canFollowUp).toBe(false)

    act(() => {
      stream.push(frame("token", { content: "You missed the deadline rule." }))
      stream.push(frame("done", { session_id: "sess1", message_id: "m1", citations: [] }))
      stream.close()
    })
    await waitFor(() => expect(result.current.canFollowUp).toBe(true))

    await act(async () => {
      await result.current.send("Why?")
    })
    expect(followUp).toEqual({ session_id: "sess1", content: "Why?" })
  })

  it("does not ask for the same explanation twice", async () => {
    const { result } = renderHook(() => useExplainChat("sub1"))

    act(() => void result.current.start())
    act(() => {
      stream.push(frame("token", { content: "Here is why." }))
      stream.push(frame("done", { session_id: "sess1", message_id: "m1", citations: [] }))
      stream.close()
    })
    await waitFor(() => expect(result.current.canFollowUp).toBe(true))

    await act(async () => {
      await result.current.start()
    })
    // A second session would strand the follow-ups on the first one.
    expect(explainCalls).toBe(1)
    expect(result.current.messages).toHaveLength(1)
  })

  // Stubs fetch rather than going through msw, for the reason useChat.test.ts
  // gives: msw's Node interceptor leaves a pending read() hanging when the
  // client aborts, so the loop never wakes and the test would time out on a
  // mechanism that works in a browser.
  it("aborts the stream on stop and keeps what had arrived", async () => {
    let bodyController!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
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

    const { result } = renderHook(() => useExplainChat("sub1"))
    act(() => void result.current.start())

    await waitFor(() => expect(bodyController).toBeDefined())
    act(() =>
      bodyController.enqueue(encoder.encode(frame("token", { content: "Partly through" }))),
    )
    await waitFor(() => expect(result.current.messages[0].content).toBe("Partly through"))

    act(() => result.current.stop())
    await waitFor(() => expect(result.current.status).toBe("stopped"))

    expect(result.current.messages[0].status).toBe("stopped")
    // No session id ever arrived, so there is nothing to ask a follow-up on.
    expect(result.current.canFollowUp).toBe(false)
  })
})
