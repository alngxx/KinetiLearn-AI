import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { UsersPage } from "@/modules/users/UsersPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function user(id: string, fullName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    email: `${fullName.toLowerCase()}@kinetilearn.com`,
    full_name: fullName,
    role: "learner",
    is_active: true,
    department_id: null,
    seniority_id: null,
    job_position_id: null,
    employee_level_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

function lookup(id: string, name: string) {
  return { id, name, description: null, is_active: true, created_at: "2026-01-01T00:00:00Z" }
}

function renderUsers() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("UsersPage", () => {
  let people: ReturnType<typeof user>[]
  let requests: { method: string; url: string; body: unknown }[]

  beforeEach(() => {
    people = [
      user("u1", "Mai", { department_id: "d1" }),
      user("u2", "Duc", { role: "admin" }),
    ]
    requests = []

    server.use(
      http.get(`${API}/api/v1/config/departments`, () => HttpResponse.json([lookup("d1", "Engineering")])),
      http.get(`${API}/api/v1/config/seniority-levels`, () => HttpResponse.json([lookup("s1", "Junior")])),
      http.get(`${API}/api/v1/config/job-positions`, () => HttpResponse.json([lookup("j1", "Developer")])),
      http.get(`${API}/api/v1/config/employee-levels`, () => HttpResponse.json([lookup("e1", "L3")])),
      http.get(`${API}/api/v1/users`, ({ request }) => {
        requests.push({ method: "GET", url: request.url, body: null })
        const role = new URL(request.url).searchParams.get("role")
        return HttpResponse.json(
          role === null ? people : people.filter((item) => item.role === role),
        )
      }),
      http.post(`${API}/api/v1/users`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "POST", url: request.url, body })
        const created = user("u3", String(body.full_name), { email: String(body.email) })
        people.push(created)
        return HttpResponse.json(created, { status: 201 })
      }),
      http.patch(`${API}/api/v1/users/:id/deactivate`, ({ request, params }) => {
        requests.push({ method: "PATCH", url: request.url, body: null })
        const target = people.find((item) => item.id === params.id)!
        target.is_active = false
        return HttpResponse.json(target)
      }),
    )
  })

  it("lists people with their role, tags and status", async () => {
    renderUsers()

    expect(await screen.findByText("Mai")).toBeInTheDocument()
    const mai = screen.getByRole("row", { name: /Mai/ })
    expect(within(mai).getByText("learner")).toBeInTheDocument()
    expect(within(mai).getByText("Engineering")).toBeInTheDocument()
    expect(within(mai).getByText("Active")).toBeInTheDocument()
    expect(screen.getByRole("row", { name: /Duc/ })).toBeInTheDocument()
  })

  it("explains a failed load and recovers when retried", async () => {
    let attempt = 0
    server.use(
      http.get(`${API}/api/v1/users`, () => {
        attempt += 1
        return attempt === 1
          ? HttpResponse.json({ detail: "Service unavailable." }, { status: 503 })
          : HttpResponse.json(people)
      }),
    )

    renderUsers()

    expect(await screen.findByText("Could not load people")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable.")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByText("Mai")).toBeInTheDocument()
    expect(screen.queryByText("Could not load people")).toBeNull()
  })

  it("refetches with the filter in the query string", async () => {
    renderUsers()
    await screen.findByText("Mai")

    await userEvent.selectOptions(screen.getByLabelText("Role"), "admin")

    await expect.poll(() => requests.some((item) => item.url.includes("role=admin"))).toBe(true)
    expect(await screen.findByText("Duc")).toBeInTheDocument()
  })

  it("creates a person with the create-only password and role fields", async () => {
    renderUsers()
    await screen.findByText("Mai")

    await userEvent.click(screen.getByRole("button", { name: /New person/ }))
    const dialog = within(screen.getByRole("dialog"))
    await userEvent.type(dialog.getByLabelText(/^Email/), "linh@kinetilearn.com")
    await userEvent.type(dialog.getByLabelText(/^Full name/), "Linh")
    await userEvent.type(dialog.getByLabelText(/^Password/), "supersecret")
    await userEvent.selectOptions(dialog.getByLabelText(/^Department/), "d1")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByText("Linh")).toBeInTheDocument()
    const post = requests.find((item) => item.method === "POST")
    expect(post?.body).toMatchObject({
      email: "linh@kinetilearn.com",
      full_name: "Linh",
      password: "supersecret",
      role: "learner",
      department_id: "d1",
    })
  })

  it("omits password and role from the edit form", async () => {
    renderUsers()
    await screen.findByText("Mai")

    await userEvent.click(within(screen.getByRole("row", { name: /Mai/ })).getByRole("button", { name: "Edit" }))

    const dialog = within(screen.getByRole("dialog"))
    expect(dialog.getByLabelText(/^Full name/)).toBeInTheDocument()
    expect(dialog.queryByLabelText(/^Password/)).toBeNull()
    expect(dialog.queryByLabelText(/^Role/)).toBeNull()
  })

  it("puts a duplicate email conflict on the email field", async () => {
    server.use(
      http.post(`${API}/api/v1/users`, () =>
        HttpResponse.json({ detail: "Email already exists" }, { status: 409 }),
      ),
    )
    renderUsers()
    await screen.findByText("Mai")

    await userEvent.click(screen.getByRole("button", { name: /New person/ }))
    const dialog = within(screen.getByRole("dialog"))
    await userEvent.type(dialog.getByLabelText(/^Email/), "mai@kinetilearn.com")
    await userEvent.type(dialog.getByLabelText(/^Full name/), "Mai Again")
    await userEvent.type(dialog.getByLabelText(/^Password/), "supersecret")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Email already exists")
    expect(dialog.getByLabelText(/^Email/)).toHaveAttribute("aria-invalid", "true")
  })

  it("deactivates a person", async () => {
    renderUsers()
    await screen.findByText("Mai")

    await userEvent.click(
      within(screen.getByRole("row", { name: /Mai/ })).getByRole("button", { name: "Deactivate" }),
    )

    // Deactivating asks first — nothing is sent until it is confirmed.
    const confirm = within(await screen.findByRole("alertdialog"))
    expect(requests.some((item) => item.method === "PATCH")).toBe(false)
    await userEvent.click(confirm.getByRole("button", { name: "Deactivate" }))

    expect(
      await within(screen.getByRole("row", { name: /Mai/ })).findByText("Inactive"),
    ).toBeInTheDocument()
    expect(requests.some((item) => item.url.endsWith("/u1/deactivate"))).toBe(true)
  })
})
