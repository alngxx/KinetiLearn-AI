import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { UserSkillsPage } from "@/modules/scoring/UserSkillsPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function renderSkills() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/users/u1/skills"]}>
        <Routes>
          <Route path="/admin/users/:userId/skills" element={<UserSkillsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
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

const breakdown = [
  {
    skill_id: "sk1",
    skill_name: "Fire safety",
    category_id: "cat1",
    category_name: "Safety",
    cumulative_score: 30,
    current_level: "intermediate",
    basic_max: 20,
    intermediate_max: 40,
    last_updated_at: "2026-03-01T00:00:00Z",
  },
  {
    skill_id: "sk2",
    skill_name: "Data handling",
    category_id: "cat2",
    category_name: "Compliance",
    cumulative_score: 0,
    current_level: "basic",
    basic_max: 15,
    intermediate_max: 30,
    last_updated_at: null,
  },
]

describe("UserSkillsPage", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API}/api/v1/users/u1`, () => HttpResponse.json(learner)),
      http.get(`${API}/api/v1/scoring/users/u1/skills`, () => HttpResponse.json(breakdown)),
    )
  })

  it("groups skills by category and shows a scored skill's level and update date", async () => {
    renderSkills()

    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument()
    expect(screen.getByText("Safety")).toBeInTheDocument()
    expect(screen.getByText("Compliance")).toBeInTheDocument()

    const fireSafety = screen.getByText("Fire safety").closest("li")!
    expect(within(fireSafety).getByText("Intermediate")).toBeInTheDocument()
    expect(within(fireSafety).getByText("30")).toBeInTheDocument()
    expect(within(fireSafety).getByText(/Updated/)).toBeInTheDocument()
  })

  // Driven from every active skill via an outer join, so an unscored one still
  // renders — at zero — rather than being missing from the page.
  it("renders an unscored skill as a real zeroed row, not a missing one", async () => {
    renderSkills()
    await screen.findByText("Alice Nguyen")

    const dataHandling = screen.getByText("Data handling").closest("li")!
    expect(within(dataHandling).getByText("0")).toBeInTheDocument()
    expect(within(dataHandling).getByText("Basic")).toBeInTheDocument()
    expect(within(dataHandling).getByText("Not yet scored")).toBeInTheDocument()
  })
})
