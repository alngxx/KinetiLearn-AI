import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { TakeQuizPage } from "@/modules/daily-quiz/TakeQuizPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function option(id: string, label: string, text: string) {
  return { id, option_label: label, option_text: text }
}

function quiz(extra: Record<string, unknown> = {}) {
  return {
    id: "dq1",
    quiz_date: "2026-08-27",
    expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    already_submitted: false,
    questions: [
      {
        id: "q1",
        question_text: "What is the reporting window?",
        order_index: 0,
        options: [option("q1a", "A", "24 hours"), option("q1b", "B", "7 days")],
      },
      {
        id: "q2",
        question_text: "Who owns the incident log?",
        order_index: 1,
        options: [option("q2a", "A", "Security"), option("q2b", "B", "Everyone")],
      },
    ],
    ...extra,
  }
}

// A fresh, empty QueryClient every time — nothing is pre-seeded, so every test
// exercises the cold-cache path the page must handle on a reload.
function renderTake(path = "/learner/quiz/dq1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/learner/quiz/:quizId" element={<TakeQuizPage />} />
          <Route path="/learner" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function questionFieldset(text: string) {
  return screen.getByRole("group", { name: new RegExp(text) })
}

describe("TakeQuizPage", () => {
  let quizzes: unknown[]
  let posted: unknown[]

  beforeEach(() => {
    quizzes = [quiz()]
    posted = []

    server.use(
      http.get(`${API}/api/v1/quiz/today`, () => HttpResponse.json(quizzes)),
      http.post(`${API}/api/v1/quiz/submissions`, async ({ request }) => {
        const body = (await request.json()) as { answers: { daily_quiz_question_id: string }[] }
        posted.push(body)
        return HttpResponse.json(
          {
            id: "sub1",
            daily_quiz_id: "dq1",
            quiz_date: "2026-08-27",
            score: 5,
            is_late: false,
            submitted_at: "2026-08-27T10:00:00Z",
            answers: [
              {
                daily_quiz_question_id: "q1",
                selected_option_id: "q1a",
                is_correct: true,
                points_earned: 5,
              },
              {
                daily_quiz_question_id: "q2",
                selected_option_id: null,
                is_correct: null,
                points_earned: 0,
              },
            ],
          },
          { status: 201 },
        )
      }),
    )
  })

  // The reload / pasted-link path. The page must fetch for itself rather than
  // reading a cache that is empty here, or a live quiz reads as missing.
  it("fetches and renders the quiz with a cold cache", async () => {
    renderTake()

    expect(await screen.findByText("What is the reporting window?")).toBeInTheDocument()
    expect(screen.getByText("Who owns the incident log?")).toBeInTheDocument()
    expect(screen.queryByText("This quiz isn’t available")).not.toBeInTheDocument()
  })

  it("shows the options without leaking the answer key", async () => {
    renderTake()
    await screen.findByText("What is the reporting window?")

    const first = questionFieldset("What is the reporting window")
    expect(within(first).getAllByRole("radio")).toHaveLength(2)
    expect(document.body.innerHTML).not.toContain("is_correct")
    expect(document.body.innerHTML).not.toContain("explanation")
  })

  it("sends only the answered questions", async () => {
    renderTake()
    await screen.findByText("What is the reporting window?")

    await userEvent.click(within(questionFieldset("What is the reporting window")).getByRole("radio", { name: /24 hours/ }))
    await userEvent.click(within(questionFieldset("Who owns the incident log")).getByRole("radio", { name: /Security/ }))
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))

    await screen.findByText("correct")
    expect(posted).toEqual([
      {
        daily_quiz_id: "dq1",
        answers: [
          { daily_quiz_question_id: "q1", selected_option_id: "q1a" },
          { daily_quiz_question_id: "q2", selected_option_id: "q2a" },
        ],
      },
    ])
  })

  it("confirms before sending with questions unanswered, naming the count", async () => {
    renderTake()
    await screen.findByText("What is the reporting window?")

    await userEvent.click(within(questionFieldset("What is the reporting window")).getByRole("radio", { name: /24 hours/ }))
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))

    expect(
      await screen.findByText("Send with 1 question unanswered?"),
    ).toBeInTheDocument()
    expect(posted).toHaveLength(0)

    await userEvent.click(screen.getByRole("button", { name: "Send anyway" }))
    await screen.findByText("correct")
    expect(posted).toHaveLength(1)
  })

  it("reports the result without inventing a maximum score", async () => {
    renderTake()
    await screen.findByText("What is the reporting window?")

    await userEvent.click(within(questionFieldset("What is the reporting window")).getByRole("radio", { name: /24 hours/ }))
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))
    await userEvent.click(await screen.findByRole("button", { name: "Send anyway" }))

    expect(await screen.findByText("1 of 2")).toBeInTheDocument()
    expect(screen.getByText("5")).toBeInTheDocument()
    expect(screen.getByText("You skipped this one")).toBeInTheDocument()
    // The correct option is in no learner-facing response, so it is not claimed.
    expect(screen.queryByText(/the answer was/i)).not.toBeInTheDocument()
  })

  // Submitting invalidates ["quiz","today"], so the quiz comes back
  // already_submitted moments later. The result must survive that.
  it("keeps the result on screen after the list refetches", async () => {
    renderTake()
    await screen.findByText("What is the reporting window?")

    await userEvent.click(within(questionFieldset("What is the reporting window")).getByRole("radio", { name: /24 hours/ }))
    quizzes = [quiz({ already_submitted: true })]
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))
    await userEvent.click(await screen.findByRole("button", { name: "Send anyway" }))

    expect(await screen.findByText("1 of 2")).toBeInTheDocument()
    expect(screen.queryByText("You’ve already answered this quiz")).not.toBeInTheDocument()
  })

  it("shows the server's message when someone already answered it", async () => {
    server.use(
      http.post(`${API}/api/v1/quiz/submissions`, () =>
        HttpResponse.json({ detail: "You have already submitted this quiz." }, { status: 400 }),
      ),
    )
    renderTake()
    await screen.findByText("What is the reporting window?")

    await userEvent.click(within(questionFieldset("What is the reporting window")).getByRole("radio", { name: /24 hours/ }))
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }))
    await userEvent.click(await screen.findByRole("button", { name: "Send anyway" }))

    expect(await screen.findByText("You have already submitted this quiz.")).toBeInTheDocument()
  })

  // The two fallbacks are different situations: one is a dead end, the other is
  // a job well done. They must not share a sentence.
  it("says a missing quiz is unavailable", async () => {
    renderTake("/learner/quiz/nope")
    expect(await screen.findByText("This quiz isn’t available")).toBeInTheDocument()
    expect(screen.queryByText("You’ve already answered this quiz")).not.toBeInTheDocument()
  })

  it("says an answered quiz is already done", async () => {
    quizzes = [quiz({ already_submitted: true })]
    renderTake()
    expect(await screen.findByText("You’ve already answered this quiz")).toBeInTheDocument()
    expect(screen.queryByText("This quiz isn’t available")).not.toBeInTheDocument()
  })

  it("surfaces a failed load rather than calling the quiz missing", async () => {
    server.use(
      http.get(`${API}/api/v1/quiz/today`, () =>
        HttpResponse.json({ detail: "Quiz service is down." }, { status: 500 }),
      ),
    )
    renderTake()

    expect(await screen.findByText("Quiz service is down.")).toBeInTheDocument()
    expect(screen.queryByText("This quiz isn’t available")).not.toBeInTheDocument()
  })
})
