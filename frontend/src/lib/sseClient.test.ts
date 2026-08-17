import { afterEach, describe, expect, it, vi } from "vitest"
import { parseFrames, streamSSE, type DonePayload } from "@/lib/sseClient"

// Byte-for-byte what _sse() in app/modules/chat/service.py writes.
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const DONE_PAYLOAD: DonePayload = {
  session_id: "3f1b0c9e-0000-4000-8000-000000000001",
  message_id: "3f1b0c9e-0000-4000-8000-000000000002",
  citations: [],
}

// Lets a test decide exactly where the network chunk boundaries fall.
function manualStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let cancelled = false
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      cancelled = true
    },
  })

  return {
    stream,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    wasCancelled: () => cancelled,
  }
}

function stubFetchWithChunks(chunks: string[], status = 200, body?: unknown) {
  const fetchMock = vi.fn(async () => {
    if (status !== 200) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    }
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    return new Response(stream, { status: 200 })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

async function runStream(chunks: string[], status = 200, body?: unknown) {
  stubFetchWithChunks(chunks, status, body)
  const tokens: string[] = []
  try {
    const done = await streamSSE("/api/v1/chat/messages", { content: "hi" }, {
      onToken: (t) => tokens.push(t),
    })
    return { tokens, done, error: null as unknown }
  } catch (error) {
    return { tokens, done: null, error }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parseFrames", () => {
  const cases = [
    {
      name: "two complete frames",
      buffer: frame("token", { content: "a" }) + frame("token", { content: "b" }),
      frames: [
        { event: "token", data: { content: "a" } },
        { event: "token", data: { content: "b" } },
      ],
      rest: "",
    },
    {
      name: "keeps a trailing partial frame in rest",
      buffer: frame("token", { content: "a" }) + "event: token\ndata: {\"cont",
      frames: [{ event: "token", data: { content: "a" } }],
      rest: 'event: token\ndata: {"cont',
    },
    {
      name: "empty buffer yields nothing",
      buffer: "",
      frames: [],
      rest: "",
    },
    {
      name: "done frame carries the full payload",
      buffer: frame("done", DONE_PAYLOAD),
      frames: [{ event: "done", data: DONE_PAYLOAD }],
      rest: "",
    },
  ]

  it.each(cases)("$name", ({ buffer, frames, rest }) => {
    expect(parseFrames(buffer)).toEqual({ frames, rest })
  })

  it("throws on a data line that is not JSON", () => {
    expect(() => parseFrames("event: token\ndata: {not json}\n\n")).toThrow()
  })
})

describe("streamSSE", () => {
  it("collects a normal token stream and resolves with the done payload", async () => {
    const { tokens, done, error } = await runStream([
      frame("token", { content: "Compliance " }),
      frame("token", { content: "training " }),
      frame("token", { content: "is mandatory." }),
      frame("done", DONE_PAYLOAD),
    ])

    expect(error).toBeNull()
    expect(tokens.join("")).toBe("Compliance training is mandatory.")
    expect(done).toEqual(DONE_PAYLOAD)
  })

  it("reassembles a frame split across chunks", async () => {
    const { tokens, done, error } = await runStream([
      "event: tok",
      'en\ndata: {"content":"hi"}\n\n' + frame("done", DONE_PAYLOAD),
    ])

    expect(error).toBeNull()
    expect(tokens).toEqual(["hi"])
    expect(done).toEqual(DONE_PAYLOAD)
  })

  it("reassembles a chunk boundary inside the JSON payload", async () => {
    const full = frame("token", { content: "half and half" })
    const cut = Math.floor(full.length / 2)
    const { tokens, error } = await runStream([
      full.slice(0, cut),
      full.slice(cut) + frame("done", DONE_PAYLOAD),
    ])

    expect(error).toBeNull()
    expect(tokens).toEqual(["half and half"])
  })

  it("rejects on a malformed data line instead of hanging", async () => {
    const { error } = await runStream(["event: token\ndata: {not json}\n\n"])
    expect(error).toBeInstanceOf(SyntaxError)
  })

  it("handles the canned no-match answer (single token, empty citations)", async () => {
    const canned =
      "I couldn't find anything about that in the training materials. " +
      "Try rephrasing, or ask about a topic covered by the uploaded documents."

    const { tokens, done, error } = await runStream([
      frame("token", { content: canned }),
      frame("done", DONE_PAYLOAD),
    ])

    expect(error).toBeNull()
    expect(tokens).toEqual([canned])
    expect(done?.citations).toEqual([])
  })

  it("treats a mid-stream error frame as a failure despite HTTP 200", async () => {
    const { tokens, done, error } = await runStream([
      frame("token", { content: "Compliance " }),
      frame("token", { content: "training " }),
      frame("error", { detail: "Failed to generate a response" }),
    ])

    expect(done).toBeNull()
    expect(error).toEqual({ status: 200, message: "Failed to generate a response" })
    // Tokens that already arrived are kept — the caller decides what to show.
    expect(tokens).toEqual(["Compliance ", "training "])
  })

  it("routes a pre-stream failure through normalizeError", async () => {
    const { tokens, error } = await runStream([], 404, { detail: "Chat session not found." })

    expect(error).toEqual({ status: 404, message: "Chat session not found." })
    expect(tokens).toEqual([])
  })

  it("rejects with AbortError and stops emitting when aborted mid-stream", async () => {
    const stream = manualStream()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream.stream, { status: 200 })))

    const controller = new AbortController()
    const onToken = vi.fn()
    const promise = streamSSE("/api/v1/chat/messages", { content: "hi" }, {
      onToken,
      signal: controller.signal,
    })

    stream.push(frame("token", { content: "a" }))
    stream.push(frame("token", { content: "b" }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    controller.abort()
    stream.push(frame("token", { content: "c" }))

    const error = await promise.catch((err) => err)

    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe("AbortError")
    // The third frame arrived after the abort and must never reach the caller.
    expect(onToken).toHaveBeenCalledTimes(2)
    expect(onToken).toHaveBeenNthCalledWith(1, "a")
    expect(onToken).toHaveBeenNthCalledWith(2, "b")
    // The reader was released rather than left dangling.
    expect(stream.wasCancelled()).toBe(true)
  })

  it("passes the signal to fetch, so aborting before the response rejects", async () => {
    let seenSignal: AbortSignal | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        seenSignal = init.signal ?? undefined
        // Stands in for fetch's own abort behaviour.
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          )
        })
      }),
    )

    const controller = new AbortController()
    const onToken = vi.fn()
    const promise = streamSSE("/api/v1/chat/messages", { content: "hi" }, {
      onToken,
      signal: controller.signal,
    })

    controller.abort()
    const error = await promise.catch((err) => err)

    // The point of the test: the signal reached fetch, not only the read loop.
    expect(seenSignal).toBe(controller.signal)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe("AbortError")
    expect(onToken).not.toHaveBeenCalled()
  })
})
