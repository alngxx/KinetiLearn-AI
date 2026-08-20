import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { ConfigEntityPage } from "@/modules/config/ConfigEntityPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

type Row = Record<string, unknown> & { id: string; name: string; is_active: boolean }

function row(id: string, name: string, extra: Record<string, unknown> = {}): Row {
  return {
    id,
    name,
    description: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

function renderEntity(entityKey: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/config/${entityKey}`]}>
        <Routes>
          <Route path="/admin/config/:entityKey" element={<ConfigEntityPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function rowFor(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) })
}

describe("ConfigEntityPage — categories", () => {
  let categories: Row[]
  let requests: { method: string; url: string; body: unknown }[]

  beforeEach(() => {
    categories = [row("c1", "Backend"), row("c2", "Frontend")]
    requests = []

    server.use(
      http.get(`${API}/api/v1/config/categories`, ({ request }) => {
        const url = new URL(request.url)
        const includeInactive = url.searchParams.get("include_inactive") === "true"
        requests.push({ method: "GET", url: request.url, body: null })
        return HttpResponse.json(
          includeInactive ? categories : categories.filter((item) => item.is_active),
        )
      }),
      http.post(`${API}/api/v1/config/categories`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "POST", url: request.url, body })
        const created = row(`c${categories.length + 1}`, String(body.name), {
          description: body.description,
        })
        categories.push(created)
        return HttpResponse.json(created, { status: 201 })
      }),
      http.put(`${API}/api/v1/config/categories/:id`, async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "PUT", url: request.url, body })
        const target = categories.find((item) => item.id === params.id)!
        Object.assign(target, body)
        return HttpResponse.json(target)
      }),
      http.patch(`${API}/api/v1/config/categories/:id/deactivate`, ({ request, params }) => {
        requests.push({ method: "PATCH", url: request.url, body: null })
        const target = categories.find((item) => item.id === params.id)!
        target.is_active = false
        return HttpResponse.json(target)
      }),
    )
  })

  it("lists the entities returned by the API", async () => {
    renderEntity("categories")

    expect(await screen.findByText("Backend")).toBeInTheDocument()
    expect(screen.getByText("Frontend")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument()
  })

  it("creates an entity and shows it in the list", async () => {
    renderEntity("categories")
    await screen.findByText("Backend")

    await userEvent.click(screen.getByRole("button", { name: /New category/ }))
    await userEvent.type(screen.getByLabelText(/^Name/), "Platform")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByText("Platform")).toBeInTheDocument()
    const post = requests.find((item) => item.method === "POST")
    expect(post?.body).toMatchObject({ name: "Platform" })
  })

  it("edits an entity through the same dialog", async () => {
    renderEntity("categories")
    await screen.findByText("Backend")

    await userEvent.click(within(rowFor("Backend")).getByRole("button", { name: "Edit" }))
    const nameInput = screen.getByLabelText(/^Name/)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, "Infra")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByText("Infra")).toBeInTheDocument()
    const put = requests.find((item) => item.method === "PUT")
    expect(put?.body).toMatchObject({ name: "Infra" })
  })

  it("deactivates an entity", async () => {
    renderEntity("categories")
    await screen.findByText("Backend")

    // Inactive rows are hidden by default, so surface them first.
    await userEvent.click(screen.getByRole("button", { name: "Show inactive" }))
    await userEvent.click(within(rowFor("Backend")).getByRole("button", { name: "Deactivate" }))

    // Deactivating asks first — nothing is sent until it is confirmed.
    const confirm = within(await screen.findByRole("alertdialog"))
    expect(requests.some((item) => item.method === "PATCH")).toBe(false)
    await userEvent.click(confirm.getByRole("button", { name: "Deactivate" }))

    expect(await within(rowFor("Backend")).findByText("Inactive")).toBeInTheDocument()
    expect(requests.some((item) => item.url.endsWith("/c1/deactivate"))).toBe(true)
  })

  it("sends nothing when the deactivate confirmation is cancelled", async () => {
    renderEntity("categories")
    await screen.findByText("Backend")

    await userEvent.click(within(rowFor("Backend")).getByRole("button", { name: "Deactivate" }))
    const confirm = within(await screen.findByRole("alertdialog"))
    await userEvent.click(confirm.getByRole("button", { name: "Cancel" }))

    expect(requests.some((item) => item.method === "PATCH")).toBe(false)
    expect(within(rowFor("Backend")).getByText("Active")).toBeInTheDocument()
  })

  it("puts a duplicate-name conflict on the field instead of a toast", async () => {
    server.use(
      http.post(`${API}/api/v1/config/categories`, () =>
        HttpResponse.json({ detail: "Category name already exists." }, { status: 409 }),
      ),
    )
    renderEntity("categories")
    await screen.findByText("Backend")

    await userEvent.click(screen.getByRole("button", { name: /New category/ }))
    await userEvent.type(screen.getByLabelText(/^Name/), "Backend")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))

    const error = await screen.findByRole("alert")
    expect(error).toHaveTextContent("Category name already exists.")
    expect(screen.getByLabelText(/^Name/)).toHaveAttribute("aria-invalid", "true")
  })

  it("explains a failed load and recovers when retried", async () => {
    let attempt = 0
    server.use(
      http.get(`${API}/api/v1/config/categories`, () => {
        attempt += 1
        return attempt === 1
          ? HttpResponse.json({ detail: "Service unavailable." }, { status: 503 })
          : HttpResponse.json(categories)
      }),
    )

    renderEntity("categories")

    expect(await screen.findByText("Could not load categories")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable.")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByText("Backend")).toBeInTheDocument()
    expect(screen.queryByText("Could not load categories")).toBeNull()
  })

  it("rejects a name with spaces before sending anything", async () => {
    renderEntity("categories")
    await screen.findByText("Backend")

    await userEvent.click(screen.getByRole("button", { name: /New category/ }))
    await userEvent.type(screen.getByLabelText(/^Name/), "Data Science")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Letters and numbers only")
    expect(requests.some((item) => item.method === "POST")).toBe(false)
  })
})

describe("ConfigEntityPage — skills variant", () => {
  let requests: { method: string; url: string; body: unknown }[]

  beforeEach(() => {
    requests = []
    server.use(
      http.get(`${API}/api/v1/config/categories`, () =>
        HttpResponse.json([row("c1", "Backend"), row("c2", "Frontend")]),
      ),
      http.get(`${API}/api/v1/config/skills`, ({ request }) => {
        requests.push({ method: "GET", url: request.url, body: null })
        return HttpResponse.json([
          row("s1", "Caching", { category_id: "c1", basic_max: 50, intermediate_max: 120 }),
        ])
      }),
    )
  })

  it("shows the category name and the threshold cut points", async () => {
    renderEntity("skills")

    expect(await screen.findByText("Caching")).toBeInTheDocument()
    const skillRow = rowFor("Caching")
    expect(within(skillRow).getByText("Backend")).toBeInTheDocument()
    expect(within(skillRow).getByText("50")).toBeInTheDocument()
    expect(within(skillRow).getByText("120")).toBeInTheDocument()
  })

  it("renders the extra fields the other entities do not have", async () => {
    renderEntity("skills")
    await screen.findByText("Caching")

    await userEvent.click(screen.getByRole("button", { name: /New skill/ }))

    // Scoped to the dialog: the page also has a "Category" filter behind it.
    const dialog = within(screen.getByRole("dialog"))
    expect(dialog.getByLabelText(/^Category/)).toBeInTheDocument()
    expect(dialog.getByLabelText(/^Basic up to/)).toBeInTheDocument()
    expect(dialog.getByLabelText(/^Intermediate up to/)).toBeInTheDocument()
  })

  it("blocks a submit where intermediate is not above basic, without calling the API", async () => {
    renderEntity("skills")
    await screen.findByText("Caching")

    await userEvent.click(screen.getByRole("button", { name: /New skill/ }))
    const dialog = within(screen.getByRole("dialog"))
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "c1")
    await userEvent.type(dialog.getByLabelText(/^Name/), "Sharding")
    await userEvent.type(dialog.getByLabelText(/^Basic up to/), "50")
    await userEvent.type(dialog.getByLabelText(/^Intermediate up to/), "50")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Must be higher than the basic cut point.",
    )
    // A POST here would be an unhandled request, which MSW is set to treat as an error.
    expect(requests.every((item) => item.method === "GET")).toBe(true)
  })

  it("refetches with category_id when the filter changes", async () => {
    renderEntity("skills")
    await screen.findByText("Caching")

    await userEvent.selectOptions(screen.getByLabelText("Category"), "c2")

    await expect
      .poll(() => requests.some((item) => item.url.includes("category_id=c2")))
      .toBe(true)
  })
})

// The backend's *Create schema for these two entities does NOT enforce the
// no-spaces name pattern, but their *Update schema does — so a name accepted on
// create could never be renamed. The UI applies the stricter Update pattern to
// both forms on purpose. These tests exist to stop that being loosened.
describe("ConfigEntityPage — the create form is as strict as the edit form", () => {
  const cases = [
    { key: "job-positions", path: "job-positions", button: /New job position/ },
    { key: "employee-levels", path: "employee-levels", button: /New employee level/ },
  ]

  for (const testCase of cases) {
    it(`refuses a name with spaces when creating a ${testCase.key} row`, async () => {
      let posted = false
      server.use(
        http.get(`${API}/api/v1/config/${testCase.path}`, () =>
          HttpResponse.json([row("x1", "Existing", { rank: 1 })]),
        ),
        http.post(`${API}/api/v1/config/${testCase.path}`, () => {
          posted = true
          return HttpResponse.json(row("x2", "Nope"), { status: 201 })
        }),
      )

      renderEntity(testCase.key)
      await screen.findByText("Existing")

      await userEvent.click(screen.getByRole("button", { name: testCase.button }))
      const dialog = within(screen.getByRole("dialog"))
      await userEvent.type(dialog.getByLabelText(/^Name/), "Senior Engineer")
      // Employee levels also require a rank; fill it so the only thing left
      // failing is the name pattern.
      const rank = dialog.queryByLabelText(/^Rank/)
      if (rank !== null) await userEvent.type(rank, "1")
      await userEvent.click(screen.getByRole("button", { name: "Create" }))

      expect(await screen.findByRole("alert")).toHaveTextContent("Letters and numbers only")
      expect(posted).toBe(false)
    })
  }
})
