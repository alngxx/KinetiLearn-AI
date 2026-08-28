import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LearnerLayout } from "@/layouts/LearnerLayout"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { ThemeProvider } from "@/modules/theme/ThemeContext"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

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

// Query-aware: the panel asks "(pointer: fine)" to decide whether autofocusing
// the composer is safe, so a stub that answers false to everything would silently
// put every test on the mobile path. Desktop unless a test says otherwise.
function stubMatchMedia({ pointerFine = true }: { pointerFine?: boolean } = {}) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("pointer: fine") ? pointerFine : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

// The real layout, so the panel is exercised where it actually lives — mounted
// beside the routed page, not standalone.
function renderLayout(options: { pointerFine?: boolean } = {}) {
  stubMatchMedia(options)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/learner"]}>
          <AuthProvider>
            <Routes>
              <Route path="/learner" element={<LearnerLayout />}>
                <Route index element={<p>Home page</p>} />
                <Route path="classes/:classId" element={<p>Class page</p>} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

function panel() {
  return screen.getByRole("complementary", { name: "Ask about your training" })
}

async function openPanel() {
  await userEvent.click(screen.getByRole("button", { name: "Ask" }))
}

async function ask(text: string) {
  await userEvent.type(within(panel()).getByLabelText("Your question"), text)
  await userEvent.click(within(panel()).getByRole("button", { name: "Send" }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ChatPanel", () => {
  let stream: ReturnType<typeof controllableStream>

  beforeEach(() => {
    stream = controllableStream()
    server.use(
      http.post(`${API}/api/v1/chat/sessions`, () =>
        HttpResponse.json(
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
        ),
      ),
      http.post(
        `${API}/api/v1/chat/messages`,
        () =>
          new HttpResponse(stream.stream, {
            headers: { "Content-Type": "text/event-stream" },
          }),
      ),
    )
  })

  it("opens from the header and focuses the question box", async () => {
    renderLayout()
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()

    await openPanel()
    expect(within(panel()).getByLabelText("Your question")).toHaveFocus()
  })

  // A phone has no hover pointer. Focusing the composer there throws the
  // keyboard up over a full-screen overlay the learner has not engaged with yet.
  it("does not focus the composer on a touch device", async () => {
    renderLayout({ pointerFine: false })
    await openPanel()

    expect(within(panel()).getByLabelText("Your question")).not.toHaveFocus()
    // Still reachable — this suppresses autofocus, it does not disable the box.
    await userEvent.click(within(panel()).getByLabelText("Your question"))
    expect(within(panel()).getByLabelText("Your question")).toHaveFocus()
  })

  it("streams an answer into the panel and shows its sources", async () => {
    renderLayout()
    await openPanel()
    await ask("what is the leave policy?")

    act(() => {
      stream.push(frame("token", { content: "Employees accrue " }))
      stream.push(frame("token", { content: "20 days." }))
    })
    expect(await within(panel()).findByText("Employees accrue 20 days.")).toBeInTheDocument()

    act(() => {
      stream.push(
        frame("done", {
          session_id: "s1",
          message_id: "m1",
          citations: [
            {
              document_chunk_id: "c1",
              document_id: "d1",
              document_title: "Leave handbook",
              chunk_index: 2,
              relevance_score: 0.87,
              content: "Employees accrue twenty days of annual leave.",
            },
          ],
        }),
      )
      stream.close()
    })

    expect(await within(panel()).findByText("1 source")).toBeInTheDocument()
    expect(within(panel()).getByText("Leave handbook")).toBeInTheDocument()
    expect(within(panel()).getByText(/87% match/)).toBeInTheDocument()
  })

  it("announces each stage in the live region, including a failure", async () => {
    renderLayout()
    await openPanel()

    const status = within(panel()).getByRole("status")
    await ask("what is the leave policy?")
    expect(status).toHaveTextContent("Answering…")

    act(() => {
      stream.push(frame("token", { content: "Employees " }))
      stream.push(frame("error", { detail: "Failed to generate a response" }))
      stream.close()
    })

    // The visible error sits in the bubble, which is not a live region — so
    // without this a screen-reader user just watches the tokens stop.
    await waitFor(() => expect(status).toHaveTextContent("Answer failed"))
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Failed to generate a response",
    )
    expect(within(panel()).getByText("Employees")).toBeInTheDocument()
  })

  it("announces a finished answer", async () => {
    renderLayout()
    await openPanel()
    const status = within(panel()).getByRole("status")
    await ask("hello")

    act(() => {
      stream.push(frame("token", { content: "Hi." }))
      stream.push(frame("done", { session_id: "s1", message_id: "m1", citations: [] }))
      stream.close()
    })

    await waitFor(() => expect(status).toHaveTextContent("Answer ready"))
  })

  it("blocks the composer while an answer is in flight", async () => {
    renderLayout()
    await openPanel()
    await ask("hello")

    expect(within(panel()).getByLabelText("Your question")).toBeDisabled()
    expect(within(panel()).queryByRole("button", { name: "Send" })).not.toBeInTheDocument()
    // Stop is the way out of that window, so it stays live.
    expect(within(panel()).getByRole("button", { name: "Stop" })).toBeEnabled()
  })

  // The panel unmounts on close but useChat does not — it lives in the layout,
  // which never unmounts. Wiring stop() into the close handler as "cleanup"
  // would break this, and so would moving useChat into ChatPanel.
  it("finishes an answer while the panel is closed and has it waiting on reopen", async () => {
    renderLayout()
    await openPanel()
    await ask("what is the leave policy?")

    act(() => {
      stream.push(frame("token", { content: "Employees accrue " }))
    })
    await within(panel()).findByText("Employees accrue")

    await userEvent.click(within(panel()).getByRole("button", { name: "Close chat" }))
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()

    act(() => {
      stream.push(frame("token", { content: "20 days." }))
      stream.push(
        frame("done", {
          session_id: "s1",
          message_id: "m1",
          citations: [
            {
              document_chunk_id: "c1",
              document_id: "d1",
              document_title: "Leave handbook",
              chunk_index: 2,
              relevance_score: 0.87,
              content: "Employees accrue twenty days of annual leave.",
            },
          ],
        }),
      )
      stream.close()
    })

    await openPanel()
    expect(within(panel()).getByText("Employees accrue 20 days.")).toBeInTheDocument()
    expect(within(panel()).getByText("1 source")).toBeInTheDocument()
  })

  it("keeps the conversation across a route change", async () => {
    renderLayout()
    await openPanel()
    await ask("what is the leave policy?")

    act(() => {
      stream.push(frame("token", { content: "Employees accrue 20 days." }))
      stream.push(frame("done", { session_id: "s1", message_id: "m1", citations: [] }))
      stream.close()
    })
    await within(panel()).findByText("Employees accrue 20 days.")

    await userEvent.click(screen.getByRole("link", { name: /Home/ }))
    expect(within(panel()).getByText("Employees accrue 20 days.")).toBeInTheDocument()
    expect(within(panel()).getByText("what is the leave policy?")).toBeInTheDocument()
  })

  // On a phone the panel covers the header, so the Ask toggle cannot be reached
  // and Escape needs a keyboard. This button is the only way out.
  it("closes from its own close button, without Escape or the header toggle", async () => {
    renderLayout()
    await openPanel()

    const close = within(panel()).getByRole("button", { name: "Close chat" })
    expect(close).toBeVisible()

    await userEvent.click(close)
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()

    // And it reopens, so closing did not tear anything down.
    await openPanel()
    expect(panel()).toBeInTheDocument()
  })

  // The panel is not a Radix Dialog, so it gets none of react-remove-scroll's
  // locking. index.css turns this class into overflow:hidden below md only —
  // jsdom loads no stylesheet, so the class is the assertable contract.
  it("marks the body while open so the small layout locks background scroll", async () => {
    renderLayout()
    expect(document.body).not.toHaveClass("chat-panel-open")

    await openPanel()
    expect(document.body).toHaveClass("chat-panel-open")

    await userEvent.click(within(panel()).getByRole("button", { name: "Close chat" }))
    expect(document.body).not.toHaveClass("chat-panel-open")
  })

  it("returns focus to the Ask toggle on close", async () => {
    renderLayout()
    const ask = screen.getByRole("button", { name: "Ask" })

    await openPanel()
    expect(within(panel()).getByLabelText("Your question")).toHaveFocus()

    await userEvent.click(within(panel()).getByRole("button", { name: "Close chat" }))
    expect(ask).toHaveFocus()
  })

  it("returns focus to the Ask toggle when closed with Escape", async () => {
    renderLayout()
    const ask = screen.getByRole("button", { name: "Ask" })

    await openPanel()
    await userEvent.keyboard("{Escape}")

    expect(ask).toHaveFocus()
  })

  it("closes on Escape", async () => {
    renderLayout()
    await openPanel()

    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  })
})
