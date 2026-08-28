import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { LearnerHomePage } from "@/modules/learner-home/LearnerHomePage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function quiz(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    quiz_date: "2026-08-27",
    expires_at: hoursFromNow(6),
    already_submitted: false,
    questions: [
      {
        id: `${id}-q1`,
        question_text: "What is the reporting window?",
        order_index: 0,
        options: [
          { id: `${id}-q1-a`, option_label: "A", option_text: "24 hours" },
          { id: `${id}-q1-b`, option_label: "B", option_text: "7 days" },
        ],
      },
    ],
    ...extra,
  }
}

function myClass(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: null,
    start_date: "2026-03-01",
    end_date: "2026-06-30",
    enrolled_at: "2026-03-02T09:00:00Z",
    exercise_count: 7,
    completed_exercise_count: 3,
    ...extra,
  }
}

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/learner"]}>
        <Routes>
          <Route path="/learner" element={<LearnerHomePage />} />
          <Route path="/learner/quiz/:quizId" element={<p>Taking a quiz</p>} />
          <Route path="/learner/classes/:classId" element={<p>A class</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function section(name: RegExp) {
  return screen.getByRole("heading", { name }).parentElement as HTMLElement
}

describe("LearnerHomePage", () => {
  let quizzes: unknown[]
  let classes: unknown[]

  beforeEach(() => {
    quizzes = [quiz("dq1")]
    classes = [myClass("cl1", "Q1 onboarding")]

    server.use(
      http.get(`${API}/api/v1/quiz/today`, () => HttpResponse.json(quizzes)),
      http.get(`${API}/api/v1/classes/me`, () => HttpResponse.json(classes)),
    )
  })

  it("shows an available quiz and the classes together", async () => {
    renderHome()

    expect(await screen.findByRole("link", { name: /Start quiz/ })).toHaveAttribute(
      "href",
      "/learner/quiz/dq1",
    )
    // The count and its noun are separate elements, so the run-together text is
    // what proves they read as one sentence.
    expect(section(/Daily quiz/).textContent).toContain("1 question")

    const classCard = await screen.findByRole("link", { name: /Q1 onboarding/ })
    expect(classCard).toHaveAttribute("href", "/learner/classes/cl1")
    expect(within(classCard).getByText("3 of 7")).toBeInTheDocument()
  })

  it("marks an answered quiz and offers no way to start it again", async () => {
    quizzes = [quiz("dq1", { already_submitted: true })]
    renderHome()

    expect(await screen.findByText("Answered")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Start quiz/ })).not.toBeInTheDocument()
  })

  // An open quiz is the one actionable thing on the page, so it is marked as
  // such rather than looking identical to one that is already done.
  it("distinguishes an open quiz from an answered one beyond the wording", async () => {
    quizzes = [quiz("dq1"), quiz("dq2", { already_submitted: true })]
    renderHome()

    await screen.findByRole("link", { name: /Start quiz/ })
    const cards = screen.getAllByRole("article")

    expect(cards[0]).toHaveAttribute("data-available")
    expect(cards[1]).not.toHaveAttribute("data-available")
  })

  it("shows progress for a class and drops the bar when there is nothing assigned", async () => {
    classes = [
      myClass("cl1", "Q1 onboarding"),
      myClass("cl2", "Empty class", { exercise_count: 0, completed_exercise_count: 0 }),
    ]
    renderHome()

    const withWork = await screen.findByRole("link", { name: /Q1 onboarding/ })
    expect(within(withWork).getByText("3 of 7")).toBeInTheDocument()

    // 0 of 0 has no honest denominator, so it says so instead of drawing a bar.
    const empty = screen.getByRole("link", { name: /Empty class/ })
    expect(within(empty).getByText("No exercises yet")).toBeInTheDocument()
    expect(empty.textContent).not.toContain("0 of 0")
  })

  it("renders both empty states independently", async () => {
    quizzes = []
    classes = []
    renderHome()

    expect(await screen.findByText("No quiz right now")).toBeInTheDocument()
    expect(screen.getByText("You are not enrolled yet")).toBeInTheDocument()
  })

  // The two sections fail independently: a broken quiz endpoint must not take
  // the class list down with it.
  it("shows an error for the failing list only, and retries it", async () => {
    let attempts = 0
    server.use(
      http.get(`${API}/api/v1/quiz/today`, () => {
        attempts += 1
        if (attempts === 1) {
          return HttpResponse.json({ detail: "Quiz service is down." }, { status: 500 })
        }
        return HttpResponse.json(quizzes)
      }),
    )
    renderHome()

    expect(await screen.findByText("Quiz service is down.")).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: /Q1 onboarding/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /Try again/ }))
    expect(await screen.findByRole("link", { name: /Start quiz/ })).toBeInTheDocument()
  })

  it("shows a class with no dates without inventing a range", async () => {
    classes = [myClass("cl1", "Q1 onboarding", { start_date: null, end_date: null })]
    renderHome()

    expect(await screen.findByText("No dates set")).toBeInTheDocument()
  })

  it("keeps the two sections separate", async () => {
    renderHome()
    await screen.findByRole("link", { name: /Start quiz/ })

    expect(within(section(/Daily quiz/)).getByRole("link", { name: /Start quiz/ })).toBeInTheDocument()
    expect(within(section(/Your classes/)).getByRole("link", { name: /Q1 onboarding/ })).toBeInTheDocument()
  })
})
