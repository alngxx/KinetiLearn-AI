import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { ExamResultPage } from "@/modules/exams/ExamResultPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

const EXAM = {
  id: "ex1",
  class_id: "cl1",
  title: "Incident reporting",
  description: null,
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

// One right, one wrong. is_correct null would be a skip; both are "missed" as
// far as the explain endpoint is concerned.
const SUBMISSION = {
  id: "sub1",
  user_id: "u1",
  exercise_id: "ex1",
  attempt_number: 2,
  submitted_at: "2026-08-20T10:00:00Z",
  score: 5,
  is_passed: false,
  is_late: false,
  answers: [
    { question_id: "q1", selected_option_id: "q1a", is_correct: true, points_earned: 5 },
    { question_id: "q2", selected_option_id: "q2b", is_correct: false, points_earned: 0 },
  ],
}

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

function sseResponse(body: BodyInit) {
  return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } })
}

function renderResult() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/learner/exams/ex1/result/sub1"]}>
        <Routes>
          <Route
            path="/learner/exams/:exerciseId/result/:submissionId"
            element={<ExamResultPage />}
          />
          <Route path="/learner/classes/:classId" element={<p>Class page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("ExamResultPage", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API}/api/v1/exams/ex1/take`, () => HttpResponse.json(EXAM)),
      http.get(`${API}/api/v1/submissions/sub1`, () => HttpResponse.json(SUBMISSION)),
    )
  })

  it("shows the score, the attempt and the pass result", async () => {
    renderResult()

    await screen.findByRole("heading", { name: "Incident reporting" })
    expect(screen.getByText("Attempt 2")).toBeInTheDocument()
    expect(screen.getByText("5 / 10")).toBeInTheDocument()
    expect(screen.getByText("1 of 2")).toBeInTheDocument()
    expect(screen.getByText("Failed")).toBeInTheDocument()
  })

  it("marks each question with the learner's own answer only", async () => {
    renderResult()

    await screen.findByRole("heading", { name: "Incident reporting" })
    expect(screen.getByText("A. The duty manager")).toBeInTheDocument()
    expect(screen.getByText("B. A week")).toBeInTheDocument()
    // The right answer to q2 is "24 hours". No learner-facing response carries
    // it, so it must not be on the page.
    expect(screen.queryByText(/24 hours/)).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain("is_correct")
  })

  it("shows a skipped question as skipped", async () => {
    server.use(
      http.get(`${API}/api/v1/submissions/sub1`, () =>
        HttpResponse.json({
          ...SUBMISSION,
          answers: [
            SUBMISSION.answers[0],
            { question_id: "q2", selected_option_id: null, is_correct: null, points_earned: 0 },
          ],
        }),
      ),
    )
    renderResult()

    expect(await screen.findByText("You skipped this one")).toBeInTheDocument()
  })

  // The server refuses a submission with nothing wrong on it, so offering the
  // button there would only produce a 400.
  it("offers no explanation when everything was answered correctly", async () => {
    server.use(
      http.get(`${API}/api/v1/submissions/sub1`, () =>
        HttpResponse.json({
          ...SUBMISSION,
          score: 10,
          is_passed: true,
          answers: SUBMISSION.answers.map((answer) => ({
            ...answer,
            is_correct: true,
            points_earned: 5,
          })),
        }),
      ),
    )
    renderResult()

    await screen.findByRole("heading", { name: "Incident reporting" })
    expect(screen.queryByRole("button", { name: /Explain/ })).not.toBeInTheDocument()
  })

  it("reports the server's own message when the result cannot be loaded", async () => {
    server.use(
      http.get(`${API}/api/v1/submissions/sub1`, () =>
        HttpResponse.json({ detail: "You cannot view this submission." }, { status: 403 }),
      ),
    )
    renderResult()

    expect(await screen.findByText("You cannot view this submission.")).toBeInTheDocument()
  })

  describe("the explanation", () => {
    it("streams the answer and then takes a follow-up on the session it created", async () => {
      const user = userEvent.setup()
      const explained: unknown[] = []
      const followed: unknown[] = []

      server.use(
        http.post(`${API}/api/v1/chat/explain`, async ({ request }) => {
          explained.push(await request.json())
          return sseResponse(
            frame("token", { content: "You picked a week, " }) +
              frame("token", { content: "but the window is 24 hours." }) +
              frame("done", {
                session_id: "sess1",
                message_id: "msg1",
                citations: [
                  {
                    document_chunk_id: "ch1",
                    document_id: "doc1",
                    document_title: "Incident policy",
                    chunk_index: 2,
                    relevance_score: 0.91,
                    content: "Reports are filed within 24 hours.",
                  },
                ],
              }),
          )
        }),
        http.post(`${API}/api/v1/chat/messages`, async ({ request }) => {
          followed.push(await request.json())
          return sseResponse(
            frame("token", { content: "Because the duty manager logs it." }) +
              frame("done", { session_id: "sess1", message_id: "msg2", citations: [] }),
          )
        }),
      )

      renderResult()
      await screen.findByRole("heading", { name: "Incident reporting" })
      await user.click(screen.getByRole("button", { name: "Explain my mistakes" }))

      expect(
        await screen.findByText("You picked a week, but the window is 24 hours."),
      ).toBeInTheDocument()
      // The request is the submission and nothing else — the server chooses the
      // questions.
      expect(explained).toEqual([{ submission_id: "sub1" }])
      expect(await screen.findByText("1 source")).toBeInTheDocument()

      await user.type(
        screen.getByRole("textbox", { name: /follow-up/i }),
        "Why the duty manager?",
      )
      await user.click(screen.getByRole("button", { name: "Send" }))

      expect(await screen.findByText("Because the duty manager logs it.")).toBeInTheDocument()
      // The session id came back in the done frame; there is no session to send
      // on before that.
      expect(followed).toEqual([{ session_id: "sess1", content: "Why the duty manager?" }])
    })

    // The button that was pressed is replaced by the answer, so without a
    // hand-off focus would fall to <body> and a keyboard user would lose the page.
    it("moves focus to the explanation when it opens", async () => {
      const user = userEvent.setup()
      const feed = controllableStream()
      server.use(http.post(`${API}/api/v1/chat/explain`, () => sseResponse(feed.stream)))

      renderResult()
      await screen.findByRole("heading", { name: "Incident reporting" })
      await user.click(screen.getByRole("button", { name: "Explain my mistakes" }))

      const section = await screen.findByRole("region", {
        name: "Explanation of your mistakes",
      })
      expect(section).toHaveFocus()
    })

    it("lets a keyboard reach the answer to scroll it", async () => {
      const user = userEvent.setup()
      const feed = controllableStream()
      server.use(http.post(`${API}/api/v1/chat/explain`, () => sseResponse(feed.stream)))

      renderResult()
      await screen.findByRole("heading", { name: "Incident reporting" })
      await user.click(screen.getByRole("button", { name: "Explain my mistakes" }))
      await screen.findByRole("region", { name: "Explanation of your mistakes" })

      // A max-height scroll container that nothing can focus cannot be scrolled
      // without a pointer.
      expect(screen.getByLabelText("The explanation")).toHaveAttribute("tabindex", "0")
    })

    it("offers no follow-up composer until the explanation has finished", async () => {
      const user = userEvent.setup()
      const feed = controllableStream()
      server.use(
        http.post(`${API}/api/v1/chat/explain`, () => sseResponse(feed.stream)),
      )

      renderResult()
      await screen.findByRole("heading", { name: "Incident reporting" })
      await user.click(screen.getByRole("button", { name: "Explain my mistakes" }))

      feed.push(frame("token", { content: "Working on it" }))
      expect(await screen.findByText("Working on it")).toBeInTheDocument()
      expect(screen.queryByRole("textbox", { name: /follow-up/i })).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument()

      feed.push(frame("done", { session_id: "sess1", message_id: "msg1", citations: [] }))
      feed.close()

      expect(await screen.findByRole("textbox", { name: /follow-up/i })).toBeInTheDocument()
    })

    it("offers a retry when the explanation fails", async () => {
      const user = userEvent.setup()
      server.use(
        http.post(`${API}/api/v1/chat/explain`, () =>
          HttpResponse.json({ detail: "Failed to search the documents" }, { status: 502 }),
        ),
      )

      renderResult()
      await screen.findByRole("heading", { name: "Incident reporting" })
      await user.click(screen.getByRole("button", { name: "Explain my mistakes" }))

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Failed to search the documents",
      )
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
      expect(screen.queryByRole("textbox", { name: /follow-up/i })).not.toBeInTheDocument()
    })
  })
})
