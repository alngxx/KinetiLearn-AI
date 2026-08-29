import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { clickRowAction } from "@/test/rowActions"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"
import { beforeEach, describe, expect, it } from "vitest"
import { ClassesPage } from "@/modules/classes/ClassesPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

type Row = Record<string, unknown> & { id: string; name: string; is_active: boolean }

function cls(id: string, name: string, extra: Record<string, unknown> = {}): Row {
  return {
    id,
    name,
    description: null,
    start_date: "2026-03-01",
    end_date: "2026-06-30",
    created_by: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

function renderClasses() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/classes"]}>
        <Routes>
          <Route path="/admin/classes" element={<ClassesPage />} />
          <Route path="/admin/classes/:classId" element={<p>Detail for a class</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function rowFor(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) })
}

// A date input ignores userEvent.type in jsdom; setting the value directly is
// what the picker does anyway.
function setDate(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe("ClassesPage", () => {
  let classes: Row[]
  let requests: { method: string; url: string; body: unknown }[]

  beforeEach(() => {
    classes = [
      cls("cl1", "Q1 onboarding"),
      cls("cl2", "Safety refresher", { is_active: false, start_date: null, end_date: null }),
    ]
    requests = []

    server.use(
      http.get(`${API}/api/v1/classes`, ({ request }) => {
        const url = new URL(request.url)
        const includeInactive = url.searchParams.get("include_inactive") === "true"
        requests.push({ method: "GET", url: request.url, body: null })
        return HttpResponse.json(
          includeInactive ? classes : classes.filter((item) => item.is_active),
        )
      }),
      http.post(`${API}/api/v1/classes`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "POST", url: request.url, body })
        const created = cls(`cl${classes.length + 1}`, String(body.name), body)
        classes.push(created)
        return HttpResponse.json(created, { status: 201 })
      }),
      http.put(`${API}/api/v1/classes/:id`, async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "PUT", url: request.url, body })
        const target = classes.find((item) => item.id === params.id)!
        // The server drops nulls (model_dump(exclude_none = True)), so the stub
        // does too — otherwise the test would assert a behaviour the API lacks.
        for (const [key, value] of Object.entries(body)) {
          if (value !== null) target[key] = value
        }
        return HttpResponse.json(target)
      }),
      http.patch(`${API}/api/v1/classes/:id/deactivate`, ({ request, params }) => {
        requests.push({ method: "PATCH", url: request.url, body: null })
        const target = classes.find((item) => item.id === params.id)!
        target.is_active = false
        return HttpResponse.json(target)
      }),
      http.patch(`${API}/api/v1/classes/:id/activate`, ({ request, params }) => {
        requests.push({ method: "PATCH", url: request.url, body: null })
        const target = classes.find((item) => item.id === params.id)!
        target.is_active = true
        return HttpResponse.json(target)
      }),
    )
  })

  it("lists classes with their run dates and status", async () => {
    renderClasses()

    expect(await screen.findByRole("link", { name: "Q1 onboarding" })).toBeInTheDocument()
    const row = rowFor("Q1 onboarding")
    expect(within(row).getByText(/2026/)).toBeInTheDocument()
    expect(within(row).getByText("Active")).toBeInTheDocument()

    // Inactive classes are hidden until asked for.
    expect(screen.queryByText("Safety refresher")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Show inactive" }))
    expect(await screen.findByRole("link", { name: "Safety refresher" })).toBeInTheDocument()
    expect(within(rowFor("Safety refresher")).getByText("No dates set")).toBeInTheDocument()
  })

  it("creates a class and shows it in the list", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: /New class/ }))
    await userEvent.type(screen.getByLabelText(/^Name/), "Q2 onboarding")
    setDate(/^Start date/, "2026-07-01")
    setDate(/^End date/, "2026-09-30")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByRole("link", { name: "Q2 onboarding" })).toBeInTheDocument()
    const post = requests.find((item) => item.method === "POST")
    expect(post?.body).toMatchObject({
      name: "Q2 onboarding",
      start_date: "2026-07-01",
      end_date: "2026-09-30",
    })
  })

  it("edits a class through the same dialog", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await clickRowAction(rowFor("Q1 onboarding"), "Edit")
    const nameInput = screen.getByLabelText(/^Name/)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, "Q1 induction")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByRole("link", { name: "Q1 induction" })).toBeInTheDocument()
    const put = requests.find((item) => item.method === "PUT")
    expect(put?.body).toMatchObject({ name: "Q1 induction" })
  })

  // buildPayload is shared by every entity form, so the null-versus-"" rule for
  // an emptied date gets its own assertion rather than riding on the suite.
  it("sends a cleared end date as null rather than an empty string", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await clickRowAction(rowFor("Q1 onboarding"), "Edit")
    setDate(/^End date/, "")
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await expect.poll(() => requests.some((item) => item.method === "PUT")).toBe(true)
    const put = requests.find((item) => item.method === "PUT")
    const body = put?.body as Record<string, unknown>
    expect(body.end_date).toBeNull()
    expect(body.end_date).not.toBe("")
    // The date that was left alone still goes over as its own value.
    expect(body.start_date).toBe("2026-03-01")
  })

  // Clearing a date saves but changes nothing server-side, so the form says so
  // rather than reporting a success it did not deliver.
  // Regression guard for the shared FieldRow kind map: a datetime-local kind was
  // added for the finalize dialog, and these two must not have been dragged
  // along with it.
  it("still renders the run dates as plain date inputs", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: /New class/ }))
    const dialog = within(await screen.findByRole("dialog"))

    expect(dialog.getByLabelText(/^Start date/)).toHaveAttribute("type", "date")
    expect(dialog.getByLabelText(/^End date/)).toHaveAttribute("type", "date")
  })

  it("warns that a set date cannot be cleared when editing", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await clickRowAction(rowFor("Q1 onboarding"), "Edit")
    const dialog = within(await screen.findByRole("dialog"))

    // Both dates are set on this class, so both carry the warning, and the
    // end date's open-ended hint is replaced rather than sitting beside it.
    const warnings = dialog.getAllByText(/Clearing this field is not supported/)
    expect(warnings).toHaveLength(2)
    expect(dialog.queryByText(/Leave both blank/)).toBeNull()

    // Announced with the field, not just floating near it.
    const endDate = dialog.getByLabelText(/^End date/)
    expect(endDate.getAttribute("aria-describedby")).toBe("end_date-help")
    expect(document.getElementById("end_date-help")).toHaveTextContent(
      /Clearing this field is not supported/,
    )
  })

  it("does not warn about an already-empty date", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: "Show inactive" }))
    await screen.findByRole("link", { name: "Safety refresher" })
    await clickRowAction(rowFor("Safety refresher"), "Edit")

    // This class has no dates at all — there is nothing that could fail to clear.
    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.queryByText(/Clearing this field is not supported/)).toBeNull()
    expect(dialog.getByText(/Leave both blank/)).toBeInTheDocument()
  })

  it("does not warn on the create form", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: /New class/ }))

    const dialog = within(await screen.findByRole("dialog"))
    expect(dialog.queryByText(/Clearing this field is not supported/)).toBeNull()
    expect(dialog.getByText(/Leave both blank/)).toBeInTheDocument()
  })

  it("blocks an end date before the start date without calling the API", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: /New class/ }))
    await userEvent.type(screen.getByLabelText(/^Name/), "Backwards")
    setDate(/^Start date/, "2026-06-30")
    setDate(/^End date/, "2026-03-01")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Must be on or after the start date.",
    )
    // Nothing left the client: every request so far is a list read.
    expect(requests.every((item) => item.method === "GET")).toBe(true)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  // Radix's DialogContent traps focus within itself while open (FocusScope
  // trapped), and this is a real Dialog — not a stub — so this exercises the
  // actual trap, not an assumption about it. It only redirects focus back
  // inside when focus tries to leave the container; moving focus to a field
  // that is already inside is accepted, not fought. Run twice on purpose: the
  // same field failing twice in a row is the case that needs the hook to
  // clear its focus target between attempts, or the second failure would
  // leave focus wherever the click landed instead of moving it back.
  it("moves focus back to the first invalid field on a blank submit, even with the dialog's own focus trap active, and even on a repeat failure", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await userEvent.click(screen.getByRole("button", { name: /New class/ }))
    const dialog = within(await screen.findByRole("dialog"))
    const nameInput = dialog.getByLabelText(/^Name/)

    // Move focus off Name before the first submit, so a pass just means "focus
    // happened to already be there" is ruled out.
    await userEvent.click(dialog.getByLabelText(/^Start date/))
    expect(nameInput).not.toHaveFocus()

    await userEvent.click(dialog.getByRole("button", { name: "Create" }))
    expect(await dialog.findByRole("alert")).toHaveTextContent("Name is required.")
    expect(nameInput).toHaveFocus()

    // Move focus away again and fail the exact same way a second time.
    await userEvent.click(dialog.getByLabelText(/^Start date/))
    expect(nameInput).not.toHaveFocus()

    await userEvent.click(dialog.getByRole("button", { name: "Create" }))
    expect(await dialog.findByRole("alert")).toHaveTextContent("Name is required.")
    expect(nameInput).toHaveFocus()

    expect(requests.every((item) => item.method === "GET")).toBe(true)
  })

  it("deactivates a class only after the confirmation", async () => {
    renderClasses()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await clickRowAction(rowFor("Q1 onboarding"), "Deactivate")

    const confirm = within(await screen.findByRole("alertdialog"))
    expect(requests.some((item) => item.method === "PATCH")).toBe(false)
    await userEvent.click(confirm.getByRole("button", { name: "Deactivate" }))

    await expect
      .poll(() => requests.some((item) => item.url.endsWith("/cl1/deactivate")))
      .toBe(true)
    expect(screen.queryByRole("link", { name: "Q1 onboarding" })).toBeNull()
  })

  it("explains a failed load and recovers when retried", async () => {
    let attempt = 0
    server.use(
      http.get(`${API}/api/v1/classes`, () => {
        attempt += 1
        return attempt === 1
          ? HttpResponse.json({ detail: "Service unavailable." }, { status: 503 })
          : HttpResponse.json(classes.filter((item) => item.is_active))
      }),
    )

    renderClasses()

    expect(await screen.findByText("Could not load classes")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable.")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByRole("link", { name: "Q1 onboarding" })).toBeInTheDocument()
    expect(screen.queryByText("Could not load classes")).toBeNull()
  })
})

// A blocked delete says why only through a toast, so these mount one. sonner's
// own Toaster is used rather than the app wrapper, which only adds theming.
function renderWithToasts() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/classes"]}>
        <Routes>
          <Route path="/admin/classes" element={<ClassesPage />} />
          <Route path="/admin/classes/:classId" element={<p>Detail for a class</p>} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  )
}

describe("ClassesPage delete", () => {
  let classes: Row[]
  let requests: { method: string; url: string }[]
  let deleteStatus: number
  let deleteDetail: string

  beforeEach(() => {
    classes = [cls("cl1", "Q1 onboarding"), cls("cl2", "Safety refresher")]
    requests = []
    deleteStatus = 200
    deleteDetail = ""

    server.use(
      http.get(`${API}/api/v1/classes`, () =>
        HttpResponse.json(classes.filter((item) => item.is_active)),
      ),
      http.delete(`${API}/api/v1/classes/:id`, ({ request, params }) => {
        requests.push({ method: "DELETE", url: request.url })
        if (deleteStatus !== 200) {
          return HttpResponse.json({ detail: deleteDetail }, { status: deleteStatus })
        }
        classes = classes.filter((item) => item.id !== params.id)
        return HttpResponse.json({ deleted: 1 })
      }),
    )
  })

  it("does not delete until the permanent confirmation is accepted", async () => {
    renderWithToasts()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await clickRowAction(rowFor("Q1 onboarding"), "Delete")

    const confirm = within(await screen.findByRole("alertdialog"))
    // Worded as permanent, so it cannot be mistaken for the deactivate confirm.
    expect(confirm.getByText(/cannot be undone/)).toBeInTheDocument()
    expect(requests).toHaveLength(0)

    await userEvent.click(confirm.getByRole("button", { name: "Cancel" }))
    expect(requests).toHaveLength(0)
    expect(screen.getByRole("link", { name: "Q1 onboarding" })).toBeInTheDocument()
  })

  it("removes the class from the list once the delete is confirmed", async () => {
    renderWithToasts()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await clickRowAction(rowFor("Q1 onboarding"), "Delete")
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete permanently",
      }),
    )

    await expect.poll(() => screen.queryByRole("link", { name: "Q1 onboarding" })).toBeNull()
    expect(requests.some((item) => item.url.endsWith("/classes/cl1"))).toBe(true)
    expect(screen.getByRole("link", { name: "Safety refresher" })).toBeInTheDocument()
  })

  it("keeps the class and shows the server's reason when exercises block it", async () => {
    deleteStatus = 409
    deleteDetail = "Cannot delete a class that has exercises. Delete its exercises first."

    renderWithToasts()
    await screen.findByRole("link", { name: "Q1 onboarding" })

    await clickRowAction(rowFor("Q1 onboarding"), "Delete")
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete permanently",
      }),
    )

    // Verbatim: the sentence names what to clear first, which a generic
    // "could not delete" would throw away.
    expect(await screen.findByText(deleteDetail)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Q1 onboarding" })).toBeInTheDocument()
  })
})
