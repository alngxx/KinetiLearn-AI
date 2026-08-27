import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { LearnerClassPage } from "@/modules/learner-home/LearnerClassPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function exercise(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    description: null,
    start_time: "2026-08-01T09:00:00Z",
    end_time: "2026-09-03T17:00:00Z",
    duration_minutes: 30,
    pass_score: 70,
    total_points: 100,
    question_count: 10,
    attempt_count: 0,
    best_score: null,
    is_passed: null,
    skill_names: [],
    ...extra,
  }
}

function renderClass(exercises: unknown[], classes: unknown[] = [], status = 200) {
  server.use(
    http.get(`${API}/api/v1/classes/me`, () => HttpResponse.json(classes)),
    http.get(`${API}/api/v1/classes/cl1/exercises`, () =>
      status === 200
        ? HttpResponse.json(exercises)
        : HttpResponse.json({ detail: "You are not a member of this class." }, { status }),
    ),
  )

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/learner/classes/cl1"]}>
        <Routes>
          <Route path="/learner/classes/:classId" element={<LearnerClassPage />} />
          <Route path="/learner" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function cardFor(title: string) {
  return screen.getByRole("heading", { name: title }).closest("article") as HTMLElement
}

describe("LearnerClassPage", () => {
  beforeEach(() => {
    server.use(http.get(`${API}/api/v1/classes/me`, () => HttpResponse.json([])))
  })

  it("shows an attempted exercise with its score and result", async () => {
    renderClass([
      exercise("ex1", "Data handling basics", {
        attempt_count: 1,
        best_score: 80,
        is_passed: true,
        skill_names: ["Compliance", "Security"],
      }),
    ])

    await screen.findByRole("heading", { name: "Data handling basics" })
    const card = cardFor("Data handling basics")

    expect(within(card).getByText("Passed")).toBeInTheDocument()
    expect(within(card).getByText("80")).toBeInTheDocument()
    expect(within(card).getByText("10")).toBeInTheDocument()
    expect(within(card).getByText("Compliance")).toBeInTheDocument()
    expect(within(card).getByText("Security")).toBeInTheDocument()
  })

  // A multi-document exam awards no skill points, so an empty list is a real
  // answer and must not render an empty label.
  it("renders no skills at all when the exercise promises none", async () => {
    renderClass([exercise("ex1", "Incident reporting")])

    await screen.findByRole("heading", { name: "Incident reporting" })
    const card = cardFor("Incident reporting")

    expect(within(card).getByText("—")).toBeInTheDocument()
    expect(within(card).queryByRole("list")).not.toBeInTheDocument()
  })

  it("offers no way to start an exercise yet", async () => {
    renderClass([exercise("ex1", "Incident reporting")])

    await screen.findByRole("heading", { name: "Incident reporting" })
    expect(screen.queryByRole("button", { name: /Start/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument()
  })

  it("surfaces the server's own message when the learner is not a member", async () => {
    renderClass([], [], 403)
    expect(await screen.findByText("You are not a member of this class.")).toBeInTheDocument()
  })

  it("shows an empty state when the class has no exercises", async () => {
    renderClass([])
    expect(await screen.findByText("No exercises yet")).toBeInTheDocument()
  })

  it("titles the page from the learner's own class list", async () => {
    renderClass(
      [exercise("ex1", "Incident reporting")],
      [
        {
          id: "cl1",
          name: "Q1 onboarding",
          description: null,
          start_date: null,
          end_date: null,
          enrolled_at: "2026-03-02T09:00:00Z",
          exercise_count: 1,
          completed_exercise_count: 0,
        },
      ],
    )

    expect(await screen.findByRole("heading", { name: "Q1 onboarding", level: 1 })).toBeInTheDocument()
  })
})
