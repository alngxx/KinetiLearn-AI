import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { SubmissionDetailPage } from "@/modules/submissions/SubmissionDetailPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function renderDetail(submissionId = "sub1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/submissions/${submissionId}`]}>
        <Routes>
          <Route path="/admin/submissions/:submissionId" element={<SubmissionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const exercise = {
  id: "ex1",
  title: "Safety exam",
  description: null,
  class_id: "cl1",
  is_active: true,
  start_time: "2026-03-01T00:00:00Z",
  end_time: "2026-03-10T00:00:00Z",
  duration_minutes: 30,
  pass_score: 40,
  total_points: 50,
  questions: [
    {
      id: "q1",
      question_text: "What comes first?",
      explanation: null,
      points: 25,
      order_index: 0,
      options: [
        { id: "o1", option_label: "A", option_text: "Check the exits", is_correct: true },
        { id: "o2", option_label: "B", option_text: "Ignore it", is_correct: false },
      ],
    },
    {
      id: "q2",
      question_text: "What comes second?",
      explanation: null,
      points: 25,
      order_index: 1,
      options: [
        { id: "o3", option_label: "A", option_text: "Report it", is_correct: true },
        { id: "o4", option_label: "B", option_text: "Nothing", is_correct: false },
      ],
    },
  ],
}

function submissionDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub1",
    user_id: "u1",
    exercise_id: "ex1",
    attempt_number: 1,
    submitted_at: "2026-03-05T10:00:00Z",
    score: 25,
    is_passed: false,
    is_late: false,
    answers: [
      { question_id: "q1", selected_option_id: "o1", is_correct: true, points_earned: 25 },
      { question_id: "q2", selected_option_id: "o4", is_correct: false, points_earned: 0 },
    ],
    ...overrides,
  }
}

const learner = {
  id: "u1",
  email: "alice@example.com",
  full_name: "Alice Nguyen",
  role: "learner",
  is_active: true,
  department_id: null,
  seniority_id: null,
  job_position_id: null,
  employee_level_id: null,
  created_at: "2026-01-01T00:00:00Z",
}

describe("SubmissionDetailPage", () => {
  let submission: Record<string, unknown>
  let patchRequests: { body: unknown }[]

  beforeEach(() => {
    submission = submissionDetail()
    patchRequests = []

    server.use(
      http.get(`${API}/api/v1/submissions/sub1`, () => HttpResponse.json(submission)),
      http.get(`${API}/api/v1/exams/ex1`, () => HttpResponse.json(exercise)),
      http.get(`${API}/api/v1/users/u1`, () => HttpResponse.json(learner)),
      http.patch(`${API}/api/v1/submissions/sub1`, async ({ request }) => {
        const body = (await request.json()) as { score: number }
        patchRequests.push({ body })
        submission = {
          ...submission,
          score: body.score,
          is_passed: body.score >= exercise.pass_score,
        }
        return HttpResponse.json(submission)
      }),
    )
  })

  it("shows the per-question breakdown with the correct and selected options", async () => {
    renderDetail()

    await screen.findByText("Safety exam")
    expect(screen.getByText("Alice Nguyen · Attempt 1")).toBeInTheDocument()

    const q1 = screen.getByText("What comes first?").closest("li")!
    expect(within(q1).getByText("25 / 25")).toBeInTheDocument()

    const q2 = screen.getByText("What comes second?").closest("li")!
    expect(within(q2).getByText("0 / 25")).toBeInTheDocument()
    expect(within(q2).getByText("Report it")).toBeInTheDocument()
    // The wrong option the learner actually picked is marked as selected.
    expect(within(q2).getByText("Nothing").closest("li")).toHaveTextContent("Selected")
  })

  it("overrides a failing score to a passing one and reflects the server's recomputed result", async () => {
    renderDetail()
    await screen.findByText("Safety exam")
    expect(screen.getByText("Failed")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /Override score/ }))
    const dialog = within(await screen.findByRole("dialog"))

    // The live preview is derived from the exercise's own pass_score before
    // the request is ever sent.
    const scoreInput = dialog.getByLabelText(/^Score/)
    await userEvent.clear(scoreInput)
    await userEvent.type(scoreInput, "45")
    expect(await dialog.findByText(/changes the result from failed to passed/)).toBeInTheDocument()

    await userEvent.click(dialog.getByRole("button", { name: "Save override" }))

    await expect.poll(() => patchRequests.length).toBe(1)
    expect(patchRequests[0].body).toEqual({ score: 45 })
    expect(await screen.findByText("Passed")).toBeInTheDocument()
    expect(screen.queryByText("Failed")).toBeNull()
  })

  it("overrides a passing score to a failing one and reflects the server's recomputed result", async () => {
    submission = submissionDetail({ score: 45, is_passed: true })
    renderDetail()
    await screen.findByText("Safety exam")
    expect(screen.getByText("Passed")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /Override score/ }))
    const dialog = within(await screen.findByRole("dialog"))

    const scoreInput = dialog.getByLabelText(/^Score/)
    await userEvent.clear(scoreInput)
    await userEvent.type(scoreInput, "20")
    expect(await dialog.findByText(/changes the result from passed to failed/)).toBeInTheDocument()

    await userEvent.click(dialog.getByRole("button", { name: "Save override" }))

    await expect.poll(() => patchRequests.length).toBe(1)
    expect(patchRequests[0].body).toEqual({ score: 20 })
    expect(await screen.findByText("Failed")).toBeInTheDocument()
    expect(screen.queryByText("Passed")).toBeNull()
  })

  it("blocks a score above the exercise's total points without calling the API", async () => {
    renderDetail()
    await screen.findByText("Safety exam")

    await userEvent.click(screen.getByRole("button", { name: /Override score/ }))
    const dialog = within(await screen.findByRole("dialog"))

    const scoreInput = dialog.getByLabelText(/^Score/)
    await userEvent.clear(scoreInput)
    await userEvent.type(scoreInput, "999")
    await userEvent.click(dialog.getByRole("button", { name: "Save override" }))

    expect(await dialog.findByText("Cannot exceed 50 points.")).toBeInTheDocument()
    expect(patchRequests).toHaveLength(0)
  })
})
