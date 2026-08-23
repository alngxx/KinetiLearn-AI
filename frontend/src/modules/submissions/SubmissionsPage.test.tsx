import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { SubmissionsPage } from "@/modules/submissions/SubmissionsPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function renderSubmissions() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/submissions"]}>
        <Routes>
          <Route path="/admin/submissions" element={<SubmissionsPage />} />
          <Route path="/admin/submissions/:submissionId" element={<p>Detail page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const classes = [
  { id: "cl1", name: "Q1 onboarding" },
  { id: "cl2", name: "Q2 onboarding" },
]

const classDetails: Record<string, Record<string, unknown>> = {
  cl1: {
    id: "cl1",
    name: "Q1 onboarding",
    member_count: 2,
    exercises: [
      { id: "ex1", title: "Safety exam", start_time: "2026-03-01T00:00:00Z", end_time: "2026-03-02T00:00:00Z", is_active: true },
    ],
  },
  cl2: {
    id: "cl2",
    name: "Q2 onboarding",
    member_count: 1,
    exercises: [
      { id: "ex2", title: "Compliance exam", start_time: "2026-04-01T00:00:00Z", end_time: "2026-04-02T00:00:00Z", is_active: true },
    ],
  },
}

const learners = [
  { id: "u1", full_name: "Alice Nguyen", email: "alice@example.com", role: "learner", is_active: true },
  { id: "u2", full_name: "Bob Tran", email: "bob@example.com", role: "learner", is_active: true },
]

function submission(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: "u1",
    exercise_id: "ex1",
    attempt_number: 1,
    submitted_at: "2026-03-05T10:00:00Z",
    score: 38,
    is_passed: false,
    is_late: false,
    ...extra,
  }
}

describe("SubmissionsPage", () => {
  let requests: { method: string; url: string }[]

  beforeEach(() => {
    requests = []

    server.use(
      http.get(`${API}/api/v1/submissions`, ({ request }) => {
        requests.push({ method: "GET", url: request.url })
        return HttpResponse.json([
          submission("sub1"),
          submission("sub2", { user_id: "u2", exercise_id: "ex2", score: 45, is_passed: true }),
        ])
      }),
      http.get(`${API}/api/v1/classes`, () => HttpResponse.json(classes)),
      http.get(`${API}/api/v1/classes/:id`, ({ params }) =>
        HttpResponse.json(classDetails[params.id as string]),
      ),
      http.get(`${API}/api/v1/users`, () => HttpResponse.json(learners)),
    )
  })

  it("lists submissions with learner name, exam title and result", async () => {
    renderSubmissions()

    // The exercise title resolves from a second, per-class fetch, so it lands
    // a render after the learner name does.
    await screen.findByText("Safety exam")
    const row = screen.getByRole("row", { name: /Alice Nguyen/ })
    expect(within(row).getByText("Safety exam")).toBeInTheDocument()
    expect(within(row).getByText("Q1 onboarding")).toBeInTheDocument()
    expect(within(row).getByText("Failed")).toBeInTheDocument()
    expect(within(row).getByText("38")).toBeInTheDocument()

    const otherRow = screen.getByRole("row", { name: /Bob Tran/ })
    expect(within(otherRow).getByText("Passed")).toBeInTheDocument()
  })

  it("filters by class, learner and exercise, sending the matching query params", async () => {
    renderSubmissions()
    await screen.findByRole("row", { name: /Alice Nguyen/ })

    await userEvent.selectOptions(screen.getByLabelText("Class"), "cl1")
    await expect
      .poll(() => requests.some((item) => item.url.includes("class_id=cl1")))
      .toBe(true)

    await userEvent.selectOptions(screen.getByLabelText("Learner"), "u1")
    await expect
      .poll(() => requests.some((item) => item.url.includes("user_id=u1")))
      .toBe(true)

    await userEvent.selectOptions(screen.getByLabelText("Exam"), "ex1")
    await expect
      .poll(() =>
        requests.some(
          (item) =>
            item.url.includes("exercise_id=ex1") &&
            item.url.includes("class_id=cl1") &&
            item.url.includes("user_id=u1"),
        ),
      )
      .toBe(true)
  })

  it("links each row to its own detail page", async () => {
    renderSubmissions()

    await userEvent.click(await screen.findByRole("link", { name: "Safety exam" }))
    expect(await screen.findByText("Detail page")).toBeInTheDocument()
  })
})
