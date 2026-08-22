import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { ClassDetailPage } from "@/modules/classes/ClassDetailPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function lookup(id: string, name: string) {
  return { id, name, is_active: true, created_at: "2026-01-01T00:00:00Z" }
}

function learner(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@example.com`,
    full_name: `Learner ${id}`,
    role: "learner",
    is_active: true,
    department_id: "d1",
    seniority_id: "s1",
    job_position_id: null,
    employee_level_id: "e1",
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/classes/cl1"]}>
        <Routes>
          <Route path="/admin/classes/:classId" element={<ClassDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("ClassDetailPage", () => {
  let detail: Record<string, unknown>
  let users: ReturnType<typeof learner>[]
  let requests: { method: string; url: string; body: unknown }[]

  beforeEach(() => {
    users = [learner("u1"), learner("u2")]
    requests = []
    detail = {
      id: "cl1",
      name: "Q1 onboarding",
      description: "The first six weeks.",
      start_date: "2026-03-01",
      end_date: "2026-06-30",
      created_by: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00Z",
      member_count: 4,
      exercises: [
        {
          id: "ex1",
          title: "Week 1 check",
          start_time: "2026-03-02T09:00:00Z",
          end_time: "2026-03-06T17:00:00Z",
          is_active: true,
        },
        {
          id: "ex2",
          title: "Week 2 check",
          start_time: "2026-03-09T09:00:00Z",
          end_time: "2026-03-13T17:00:00Z",
          is_active: false,
        },
      ],
    }

    server.use(
      http.get(`${API}/api/v1/config/departments`, () =>
        HttpResponse.json([lookup("d1", "Operations")]),
      ),
      http.get(`${API}/api/v1/config/seniority-levels`, () =>
        HttpResponse.json([lookup("s1", "Junior")]),
      ),
      http.get(`${API}/api/v1/config/employee-levels`, () =>
        HttpResponse.json([lookup("e1", "L2")]),
      ),
      http.get(`${API}/api/v1/classes/cl1`, ({ request }) => {
        requests.push({ method: "GET", url: request.url, body: null })
        return HttpResponse.json(detail)
      }),
      http.get(`${API}/api/v1/users`, ({ request }) => {
        requests.push({ method: "GET", url: request.url, body: null })
        const url = new URL(request.url)
        const wanted: [string, string][] = []
        url.searchParams.forEach((value, key) => wanted.push([key, value]))
        // Same AND semantics the endpoint has, and no is_active rule of its own.
        const matched = users.filter((user) =>
          wanted.every(([key, value]) => (user as Record<string, unknown>)[key] === value),
        )
        return HttpResponse.json(matched)
      }),
      http.post(`${API}/api/v1/classes/cl1/members/bulk`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "POST", url: request.url, body })
        detail.member_count = 6
        return HttpResponse.json({ total_matched: 3, added: 2, skipped: 1 })
      }),
    )
  })

  it("shows the member count and the exercises, drafts included", async () => {
    renderDetail()

    expect(await screen.findByRole("heading", { name: "Q1 onboarding" })).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByText("people enrolled")).toBeInTheDocument()

    const live = screen.getByRole("row", { name: /Week 1 check/ })
    expect(within(live).getByText("Live")).toBeInTheDocument()
    const draft = screen.getByRole("row", { name: /Week 2 check/ })
    expect(within(draft).getByText("Draft")).toBeInTheDocument()
  })

  it("keeps the bulk enrol submit disabled until a filter is set", async () => {
    renderDetail()
    await screen.findByRole("heading", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: /Bulk enrol/ }))
    const dialog = within(await screen.findByRole("dialog"))

    expect(dialog.getByRole("button", { name: "Add to class" })).toBeDisabled()
    expect(dialog.getByText("Set at least one filter to see who matches.")).toBeInTheDocument()
    // Nothing has been counted or written while the filter set is empty.
    expect(requests.some((item) => item.url.includes("/users"))).toBe(false)
    expect(requests.some((item) => item.method === "POST")).toBe(false)
  })

  it("previews how many active learners match before anything is written", async () => {
    // One of the two matching learners is deactivated, so the count is 1 —
    // bulk_add_members filters on is_active and GET /users does not.
    users = [learner("u1"), learner("u2", { is_active: false })]

    renderDetail()
    await screen.findByRole("heading", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: /Bulk enrol/ }))
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.selectOptions(dialog.getByLabelText("Department"), "d1")

    expect(await dialog.findByText("1 person matches.")).toBeInTheDocument()
    const preview = requests.find((item) => item.url.includes("/users"))
    expect(preview?.url).toContain("role=learner")
    expect(preview?.url).toContain("department_id=d1")
    // Counting is a read — nothing has been enrolled yet.
    expect(requests.some((item) => item.method === "POST")).toBe(false)
  })

  it("enrols people and reports what was added and skipped", async () => {
    renderDetail()
    await screen.findByRole("heading", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: /Bulk enrol/ }))
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.selectOptions(dialog.getByLabelText("Department"), "d1")
    await userEvent.selectOptions(dialog.getByLabelText("Employee level"), "e1")
    await userEvent.click(dialog.getByRole("button", { name: "Add to class" }))

    expect(await dialog.findByText("2 people added")).toBeInTheDocument()
    expect(dialog.getByText(/3 matched · 2 added · 1 already in the class/)).toBeInTheDocument()

    const post = requests.find((item) => item.method === "POST")
    expect(post?.body).toEqual({ department_id: "d1", employee_level_id: "e1" })

    // The detail query is dropped by the mutation, so the count comes back fresh.
    await userEvent.click(dialog.getByRole("button", { name: "Done" }))
    expect(await screen.findByText("6")).toBeInTheDocument()
  })
})
