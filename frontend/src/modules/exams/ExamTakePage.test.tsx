import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExamTakePage } from "@/modules/exams/ExamTakePage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

// Well past end_time by default, so the countdown is bounded by the learner's
// own 30 minutes and not by the exam closing.
const EXAM = {
  id: "ex1",
  class_id: "cl1",
  title: "Incident reporting",
  description: "What to do in the first hour.",
  start_time: "2026-08-01T09:00:00Z",
  end_time: "2026-12-01T17:00:00Z",
  duration_minutes: 30,
  pass_score: 6,
  total_points: 10,
  questions: [
    {
      id: "q1",
      question_text: "Who do you call first?",
      points: 5,
      order_index: 0,
      options: [
        { id: "q1a", option_label: "A", option_text: "The duty manager" },
        { id: "q1b", option_label: "B", option_text: "Your line manager" },
      ],
    },
    {
      id: "q2",
      question_text: "How long do you have to file the report?",
      points: 5,
      order_index: 1,
      options: [
        { id: "q2a", option_label: "A", option_text: "24 hours" },
        { id: "q2b", option_label: "B", option_text: "A week" },
      ],
    },
  ],
}

let posted: unknown[] = []

function renderTake(path = "/learner/exams/ex1/take") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/learner/exams/:exerciseId/take" element={<ExamTakePage />} />
          <Route
            path="/learner/exams/:exerciseId/result/:submissionId"
            element={<p>Result page</p>}
          />
          <Route path="/learner/classes/:classId" element={<p>Class page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("ExamTakePage", () => {
  beforeEach(() => {
    posted = []
    server.use(
      http.get(`${API}/api/v1/exams/ex1/take`, () => HttpResponse.json(EXAM)),
      http.post(`${API}/api/v1/submissions`, async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json({ id: "sub1" }, { status: 201 })
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("loads the exam from the server on a cold cache", async () => {
    renderTake()

    await screen.findByRole("heading", { name: "Incident reporting" })
    expect(screen.getByRole("group", { name: /Who do you call first/ })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /The duty manager/ })).toBeInTheDocument()
  })

  // The learner payload has no is_correct and no explanation on it, so there is
  // nothing to mark. This is the check that the page invents no marking of its
  // own before an answer has been sent.
  it("marks nothing before the answers are sent", async () => {
    renderTake()

    await screen.findByRole("heading", { name: "Incident reporting" })
    expect(screen.queryByText(/Correct/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Incorrect/)).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain("is_correct")
  })

  it("sends only the answered questions and lands on the result", async () => {
    const user = userEvent.setup()
    renderTake()

    await screen.findByRole("heading", { name: "Incident reporting" })
    await user.click(screen.getByRole("radio", { name: /The duty manager/ }))
    await user.click(screen.getByRole("radio", { name: /24 hours/ }))
    await user.click(screen.getByRole("button", { name: "Send answers" }))

    await screen.findByText("Result page")
    expect(posted).toEqual([
      {
        exercise_id: "ex1",
        answers: [
          { question_id: "q1", selected_option_id: "q1a" },
          { question_id: "q2", selected_option_id: "q2a" },
        ],
      },
    ])
  })

  it("asks before sending with a question unanswered, and sends only what was answered", async () => {
    const user = userEvent.setup()
    renderTake()

    await screen.findByRole("heading", { name: "Incident reporting" })
    await user.click(screen.getByRole("radio", { name: /The duty manager/ }))
    await user.click(screen.getByRole("button", { name: "Send answers" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Send with 1 question unanswered?")).toBeInTheDocument()
    // Retries are unlimited on an exam, unlike the daily quiz, so the dialog
    // must not claim this is the learner's only shot.
    expect(within(dialog).queryByText(/only one attempt/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Send anyway" }))

    await screen.findByText("Result page")
    expect(posted).toEqual([
      { exercise_id: "ex1", answers: [{ question_id: "q1", selected_option_id: "q1a" }] },
    ])
  })

  it("reports the server's own reason when the exam cannot be opened", async () => {
    server.use(
      http.get(`${API}/api/v1/exams/ex1/take`, () =>
        HttpResponse.json({ detail: "Exercise has not started yet." }, { status: 400 }),
      ),
    )
    renderTake()

    expect(await screen.findByText("Exercise has not started yet.")).toBeInTheDocument()
  })

  it("reports a failed submit without leaving the answers", async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`${API}/api/v1/submissions`, () =>
        HttpResponse.json({ detail: "Exercise is not finalized." }, { status: 400 }),
      ),
    )
    renderTake()

    await screen.findByRole("heading", { name: "Incident reporting" })
    await user.click(screen.getByRole("radio", { name: /The duty manager/ }))
    await user.click(screen.getByRole("radio", { name: /24 hours/ }))
    await user.click(screen.getByRole("button", { name: "Send answers" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Exercise is not finalized.")
    expect(screen.getByRole("radio", { name: /The duty manager/ })).toBeChecked()
  })

  describe("the timer", () => {
    // Exact values at two points, not merely "it changed". A mountedAt that were
    // recomputed on every render would leave the countdown pinned at 30:00,
    // which a looser assertion would happily pass.
    it("counts down from the moment the page opened", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      renderTake()

      expect(await screen.findByText("30:00")).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(60_000)
      expect(screen.getByText("29:00")).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(60_000)
      expect(screen.getByText("28:00")).toBeInTheDocument()
    })

    // Readable on demand rather than hidden: a screen reader user must be able
    // to ask how long is left, without the number announcing itself each second.
    it("exposes the remaining time as a timer, not as hidden text", async () => {
      renderTake()

      const timer = await screen.findByRole("timer")
      expect(timer).toHaveTextContent("30:00")
      expect(timer).not.toHaveAttribute("aria-hidden")
      expect(timer).not.toHaveAttribute("aria-live", "polite")
    })

    it("warns under five minutes", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      renderTake()

      await screen.findByText("30:00")
      expect(screen.queryByText("Under five minutes left.")).not.toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(26 * 60_000)
      expect(screen.getByText("Under five minutes left.")).toBeInTheDocument()
    })

    // Nothing on the server records when an attempt started, so an auto-submit
    // would be both unenforceable and destructive. Expiry warns and leaves the
    // answers alone.
    it("never sends the answers by itself when the time runs out", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      renderTake()

      await screen.findByText("30:00")
      await vi.advanceTimersByTimeAsync(31 * 60_000)

      expect(screen.getByText("Time is up")).toBeInTheDocument()
      expect(
        screen.getByText(/You can still send your answers — they will be recorded as late./),
      ).toBeInTheDocument()
      expect(posted).toEqual([])
      expect(screen.getByRole("button", { name: "Send answers" })).toBeEnabled()
    })

    // end_time before the learner's own window would run out: the exam closing
    // is the binding limit, and the label says which one is counting down.
    it("counts down to the closing time when that comes first", async () => {
      const closesSoon = new Date(Date.now() + 10 * 60_000).toISOString()
      server.use(
        http.get(`${API}/api/v1/exams/ex1/take`, () =>
          HttpResponse.json({ ...EXAM, end_time: closesSoon }),
        ),
      )
      renderTake()

      expect(await screen.findByText("until this exam closes")).toBeInTheDocument()
      expect(screen.getByText(/^(10:00|9:5\d)$/)).toBeInTheDocument()
    })

    it("says that reloading restarts it", async () => {
      renderTake()

      expect(
        await screen.findByText(/The timer starts when you open this page and restarts/),
      ).toBeInTheDocument()
    })
  })
})
