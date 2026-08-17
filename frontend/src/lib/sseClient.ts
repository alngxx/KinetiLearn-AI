// Reads the chat SSE streams from app/modules/chat. EventSource cannot be used:
// it is GET-only and cannot send an Authorization header, so this reads the body
// stream from fetch directly.
//
// Frames are emitted by _sse() in chat/service.py as:
//   event: <name>\ndata: <json>\n\n
// with three names: token {content}, done {session_id, message_id, citations},
// error {detail}.

import { API_BASE_URL, authHeaders, handleUnauthorized } from "@/lib/apiClient"
import { networkError, normalizeError, type ApiError } from "@/lib/errors"

export type SSEFrame = {
  event: string
  data: unknown
}

export type Citation = {
  document_chunk_id: string
  document_id: string
  document_title: string
  chunk_index: number
  relevance_score: number
  content: string
}

export type DonePayload = {
  session_id: string
  message_id: string
  citations: Citation[]
}

export type StreamOptions = {
  onToken: (content: string) => void
  signal?: AbortSignal
}

// Splits whatever has arrived so far into complete frames. A frame that is only
// half here stays in `rest` and is parsed once the remainder arrives — network
// chunks never line up with frame boundaries.
export function parseFrames(buffer: string): { frames: SSEFrame[]; rest: string } {
  const blocks = buffer.split("\n\n")
  const rest = blocks.pop() ?? ""
  const frames: SSEFrame[] = []

  for (const block of blocks) {
    if (block.trim() === "") continue

    let event = "message"
    const dataLines: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim()
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim())
    }

    // Throwing here is deliberate: a frame the client cannot read means the
    // answer is incomplete, and silently dropping it would look like success.
    frames.push({ event, data: JSON.parse(dataLines.join("\n")) })
  }

  return { frames, rest }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError")
}

// Resolves with the done payload. Rejects with an ApiError on failure, or with an
// AbortError DOMException when the caller aborts — see the note on `signal`.
export async function streamSSE(
  path: string,
  body: unknown,
  options: StreamOptions,
): Promise<DonePayload> {
  const { onToken, signal } = options

  let response: Response
  try {
    // The signal goes into fetch itself, not just the read loop below: that is
    // what rejects immediately when abort lands before the response, and what
    // tears the connection down (cancelling the generator server-side) when it
    // lands mid-body.
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw networkError()
  }

  // Anything raised before the stream starts — 404 session, 502 retrieval, 422
  // body — comes back as ordinary JSON, because chat/router.py awaits the
  // service before returning the StreamingResponse.
  if (!response.ok) {
    if (response.status === 401) handleUnauthorized()
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    throw normalizeError(response.status, payload)
  }

  if (response.body === null) throw networkError()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let done: DonePayload | null = null

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      // Secondary guard only: a chunk can already be decoded and in hand at the
      // moment abort lands, and it must not reach onToken.
      if (signal?.aborted) throw abortError()

      buffer += decoder.decode(chunk.value, { stream: true })
      const parsed = parseFrames(buffer)
      buffer = parsed.rest

      for (const frame of parsed.frames) {
        if (frame.event === "token") {
          onToken((frame.data as { content: string }).content)
        } else if (frame.event === "error") {
          // Status is already 200 here: the generator failed after the response
          // headers were sent, so only the frame marks it as a failure.
          const error: ApiError = normalizeError(200, frame.data)
          throw error
        } else if (frame.event === "done") {
          done = frame.data as DonePayload
        }
      }
    }
  } finally {
    // Runs whether the loop ended normally, threw, or was aborted, so the
    // stream is never left open.
    await reader.cancel().catch(() => {})
  }

  if (done === null) throw networkError()
  return done
}
