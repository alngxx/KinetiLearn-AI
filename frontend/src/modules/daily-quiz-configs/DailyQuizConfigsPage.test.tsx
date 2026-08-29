import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { clickRowAction } from "@/test/rowActions"
import { http, HttpResponse } from "msw"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DailyQuizConfigsPage } from "@/modules/daily-quiz-configs/DailyQuizConfigsPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

type Row = Record<string, unknown> & { id: string; name: string; is_active: boolean }
type DocRow = Record<string, unknown> & { document_id: string; title: string }

function config(id: string, name: string, extra: Record<string, unknown> = {}): Row {
  return {
    id,
    name,
    prompt: "Cover last week's material.",
    source_document_id: "doc1",
    target_department_id: null,
    target_seniority_id: null,
    target_job_position_id: null,
    target_employee_level_id: null,
    start_date: "2026-03-01",
    end_date: null,
    push_time: "09:00:00",
    timezone: "Asia/Ho_Chi_Minh",
    expiry_hours: 24,
    question_count: 5,
    created_by: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    last_run_at: null,
    last_run_status: null,
    last_run_error: null,
    ...extra,
  }
}

// Anchored off the clock the test runs on, so the relative label the component
// derives stays the same whenever the suite runs.
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function doc(id: string, title: string, extra: Record<string, unknown> = {}): DocRow {
  return {
    document_id: id,
    title,
    category_id: null,
    active_version_number: 1,
    is_active: true,
    active_version_processing_status: "ready",
    skill_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

function renderConfigs(initialEntries = ["/admin/daily-quiz-configs"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <DailyQuizConfigsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function rowFor(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) })
}

// jsdom ignores userEvent.type for date and time inputs; setting the value
// directly is what the native picker does anyway.
function setValue(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

// The real bug this fix addresses: ICU's supportedValuesOf("timeZone") only
// lists its own canonical spelling of each zone, and "Asia/Ho_Chi_Minh" is not
// among them (it canonicalises to "Asia/Saigon"). Pinning the list here rather
// than relying on the host's actual ICU database keeps the test from silently
// passing or failing as that database changes.
const TIMEZONES_WITHOUT_HCM = ["UTC", "Asia/Saigon", "Asia/Bangkok", "America/New_York"]

describe("DailyQuizConfigsPage", () => {
  let configs: Row[]
  let requests: { method: string; url: string; body: unknown }[]

  beforeEach(() => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(TIMEZONES_WITHOUT_HCM)

    configs = [
      config("cfg1", "Morning refresher", { target_department_id: "dep1" }),
      config("cfg2", "Old cadence", { is_active: false, start_date: "2025-01-01" }),
    ]
    requests = []

    const documents: DocRow[] = [
      doc("doc1", "Onboarding handbook"),
      doc("doc2", "Not ready yet", { active_version_processing_status: "processing" }),
    ]

    server.use(
      http.get(`${API}/api/v1/daily-quiz-configs`, ({ request }) => {
        const url = new URL(request.url)
        const includeInactive = url.searchParams.get("include_inactive") === "true"
        requests.push({ method: "GET", url: request.url, body: null })
        return HttpResponse.json(
          includeInactive ? configs : configs.filter((item) => item.is_active),
        )
      }),
      http.post(`${API}/api/v1/daily-quiz-configs`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "POST", url: request.url, body })
        const created = config(`cfg${configs.length + 1}`, String(body.name), body)
        configs.push(created)
        return HttpResponse.json(created, { status: 201 })
      }),
      http.put(`${API}/api/v1/daily-quiz-configs/:id`, async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "PUT", url: request.url, body })
        const target = configs.find((item) => item.id === params.id)!
        for (const [key, value] of Object.entries(body)) {
          if (value !== null) target[key] = value
        }
        return HttpResponse.json(target)
      }),
      http.patch(`${API}/api/v1/daily-quiz-configs/:id/deactivate`, ({ request, params }) => {
        requests.push({ method: "PATCH", url: request.url, body: null })
        const target = configs.find((item) => item.id === params.id)!
        target.is_active = false
        return HttpResponse.json(target)
      }),
      http.patch(`${API}/api/v1/daily-quiz-configs/:id/activate`, ({ request, params }) => {
        requests.push({ method: "PATCH", url: request.url, body: null })
        const target = configs.find((item) => item.id === params.id)!
        target.is_active = true
        return HttpResponse.json(target)
      }),
      http.get(`${API}/api/v1/documents`, () => HttpResponse.json(documents)),
      http.get(`${API}/api/v1/config/departments`, () =>
        HttpResponse.json([{ id: "dep1", name: "Engineering" }]),
      ),
      http.get(`${API}/api/v1/config/seniority-levels`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/config/job-positions`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/config/employee-levels`, () => HttpResponse.json([])),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("lists configs with their schedule, timezone and audience tags", async () => {
    renderConfigs()

    await screen.findByText("Morning refresher")
    const row = rowFor("Morning refresher")
    expect(within(row).getByText("Engineering")).toBeInTheDocument()
    expect(within(row).getByText(/9:00/)).toBeInTheDocument()
    expect(within(row).getByText(/Asia\/Ho_Chi_Minh/)).toBeInTheDocument()
    expect(within(row).getByText("Active")).toBeInTheDocument()

    // Inactive configs are hidden until asked for.
    expect(screen.queryByText("Old cadence")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Show inactive" }))
    expect(await screen.findByText("Old cadence")).toBeInTheDocument()
  })

  it("creates a config end to end with the expected payload", async () => {
    renderConfigs()
    await screen.findByText("Morning refresher")

    await userEvent.click(screen.getByRole("button", { name: /New config/ }))
    const dialog = within(await screen.findByRole("dialog"))

    await userEvent.type(dialog.getByLabelText(/^Name/), "Evening refresher")
    await userEvent.type(dialog.getByLabelText(/^Prompt/), "Cover the new safety module.")
    await userEvent.selectOptions(dialog.getByLabelText(/^Source document/), "doc1")
    setValue(/^Start date/, "2026-04-01")
    setValue(/^Push time/, "08:15")

    await userEvent.click(dialog.getByRole("button", { name: "Create" }))

    expect(await screen.findByText("Evening refresher")).toBeInTheDocument()
    const post = requests.find((item) => item.method === "POST")
    expect(post?.body).toMatchObject({
      name: "Evening refresher",
      prompt: "Cover the new safety module.",
      source_document_id: "doc1",
      start_date: "2026-04-01",
      end_date: null,
      push_time: "08:15",
      timezone: "Asia/Ho_Chi_Minh",
      expiry_hours: 24,
      question_count: 5,
      target_department_id: null,
      target_seniority_id: null,
      target_job_position_id: null,
      target_employee_level_id: null,
    })
  })

  // Only a document with a ready active version is offered — mirrors
  // DailyQuizConfigService._check_document, which 400s on anything less.
  it("only offers documents whose active version has finished processing", async () => {
    renderConfigs()
    await screen.findByText("Morning refresher")

    await userEvent.click(screen.getByRole("button", { name: /New config/ }))
    const dialog = within(await screen.findByRole("dialog"))
    const select = dialog.getByLabelText(/^Source document/) as HTMLSelectElement
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent)

    expect(labels).toContain("Onboarding handbook")
    expect(labels).not.toContain("Not ready yet")
  })

  it("edits a config through the same dialog, converting numeric fields", async () => {
    renderConfigs()
    await screen.findByText("Morning refresher")

    await clickRowAction(rowFor("Morning refresher"), "Edit")
    const dialog = within(await screen.findByRole("dialog"))
    const questionCount = dialog.getByLabelText(/^Question count/)
    await userEvent.clear(questionCount)
    await userEvent.type(questionCount, "8")
    await userEvent.click(dialog.getByRole("button", { name: "Save changes" }))

    await expect.poll(() => requests.some((item) => item.method === "PUT")).toBe(true)
    const put = requests.find((item) => item.method === "PUT")
    expect(put?.body).toMatchObject({ question_count: 8 })
    expect(typeof (put!.body as Record<string, unknown>).question_count).toBe("number")
  })

  // Pins the actual bug found during exploration: Intl.supportedValuesOf
  // omits "Asia/Ho_Chi_Minh" (it canonicalises to "Asia/Saigon"), so without
  // preserving the row's current value the select would silently fall back to
  // no selection on reopen — and saving from there would rewrite the config's
  // zone out from under it.
  it("keeps the exact timezone selected when the edit dialog reopens, even though Intl's list omits it", async () => {
    renderConfigs()
    await screen.findByText("Morning refresher")

    await clickRowAction(rowFor("Morning refresher"), "Edit")
    const dialog = within(await screen.findByRole("dialog"))
    const tzSelect = dialog.getByLabelText(/^Timezone/) as HTMLSelectElement

    expect(tzSelect.value).toBe("Asia/Ho_Chi_Minh")
    const values = Array.from(tzSelect.querySelectorAll("option")).map(
      (option) => (option as HTMLOptionElement).value,
    )
    expect(values.filter((value) => value === "Asia/Ho_Chi_Minh")).toHaveLength(1)

    // Saving without touching timezone must not rewrite it to something else.
    await userEvent.click(dialog.getByRole("button", { name: "Save changes" }))
    await expect.poll(() => requests.some((item) => item.method === "PUT")).toBe(true)
    const put = requests.find((item) => item.method === "PUT")
    expect((put!.body as Record<string, unknown>).timezone).toBe("Asia/Ho_Chi_Minh")
  })

  it("blocks an end date before the start date without calling the API", async () => {
    renderConfigs()
    await screen.findByText("Morning refresher")

    await userEvent.click(screen.getByRole("button", { name: /New config/ }))
    const dialog = within(await screen.findByRole("dialog"))

    await userEvent.type(dialog.getByLabelText(/^Name/), "Backwards")
    await userEvent.type(dialog.getByLabelText(/^Prompt/), "Anything.")
    await userEvent.selectOptions(dialog.getByLabelText(/^Source document/), "doc1")
    setValue(/^Start date/, "2026-06-30")
    setValue(/^End date/, "2026-03-01")
    setValue(/^Push time/, "08:00")
    await userEvent.click(dialog.getByRole("button", { name: "Create" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Must be on or after the start date.",
    )
    expect(requests.every((item) => item.method === "GET")).toBe(true)
  })

  // update() drops nulls (model_dump(exclude_none = True)), so clearing a set
  // target does not reach the row. The already-unset targets get no warning.
  it("warns that a set audience target cannot be cleared when editing, but not an unset one", async () => {
    renderConfigs()
    await screen.findByText("Morning refresher")

    await clickRowAction(rowFor("Morning refresher"), "Edit")
    const dialog = within(await screen.findByRole("dialog"))

    const department = dialog.getByLabelText(/^Department/)
    const describedBy = department.getAttribute("aria-describedby")
    expect(describedBy).toContain("target_department_id-help")
    expect(document.getElementById("target_department_id-help")).toHaveTextContent(
      /Clearing this field is not supported/,
    )

    const seniority = dialog.getByLabelText(/^Seniority/)
    expect(seniority.getAttribute("aria-describedby")).toBeNull()
  })

  it("shows Never run for a config the beat task has not stamped yet", async () => {
    renderConfigs()

    await screen.findByText("Morning refresher")
    expect(within(rowFor("Morning refresher")).getByText("Never run")).toBeInTheDocument()
  })

  it("shows the relative time and a success badge for a successful run", async () => {
    configs = [
      config("cfg1", "Morning refresher", {
        last_run_at: hoursAgo(2),
        last_run_status: "success",
        last_run_error: null,
      }),
    ]
    renderConfigs()

    await screen.findByText("Morning refresher")
    const row = rowFor("Morning refresher")
    expect(within(row).getByText("2 hours ago")).toBeInTheDocument()
    expect(within(row).getByText("Success")).toBeInTheDocument()
    expect(within(row).queryByText("Never run")).toBeNull()
  })

  // A skipped run carries a real reason, and it is the only place that reason
  // surfaces — muted rather than destructive, since it is not an error.
  it("shows the reason for a skipped run", async () => {
    configs = [
      config("cfg1", "Morning refresher", {
        last_run_at: hoursAgo(1),
        last_run_status: "skipped",
        last_run_error: "No matching learners",
      }),
    ]
    renderConfigs()

    await screen.findByText("Morning refresher")
    const row = rowFor("Morning refresher")
    expect(within(row).getByText("Skipped")).toBeInTheDocument()

    const reason = within(row).getByText("No matching learners")
    expect(reason).toHaveClass("max-w-52", "break-words", "text-muted-foreground")
    expect(reason).not.toHaveClass("text-destructive")
    // Wraps rather than hiding behind a mouse-only title.
    expect(reason).not.toHaveAttribute("title")
  })

  // A successful run stamps no reason, so nothing extra should appear.
  it("shows no reason line for a successful run", async () => {
    configs = [
      config("cfg1", "Morning refresher", {
        last_run_at: hoursAgo(1),
        last_run_status: "success",
        last_run_error: null,
      }),
    ]
    renderConfigs()

    await screen.findByText("Morning refresher")
    const row = rowFor("Morning refresher")
    expect(within(row).getByText("Success")).toBeInTheDocument()
    // A success stamps no last_run_error, so the reason line never renders —
    // only the time+badge row sits under it.
    const timeBadgeRow = row.querySelector("time")?.parentElement
    expect(timeBadgeRow?.parentElement?.children).toHaveLength(1)
  })

  // The cell wraps rather than truncating, so the whole error is always in the
  // accessibility tree — no title attribute standing in for it.
  it("shows a failed badge with the run error wrapped in the cell", async () => {
    const error = "OpenAI request failed: rate limit exceeded, retry after 60 seconds"
    configs = [
      config("cfg1", "Morning refresher", {
        last_run_at: hoursAgo(3),
        last_run_status: "failed",
        last_run_error: error,
      }),
    ]
    renderConfigs()

    await screen.findByText("Morning refresher")
    const row = rowFor("Morning refresher")
    expect(within(row).getByText("Failed")).toBeInTheDocument()

    // Width-capped, not clipped: an uncapped block would still set the
    // column's max-content width and push the Actions column out of the
    // table, so the cap stays even though the text now wraps instead of
    // truncating.
    const message = within(row).getByText(error)
    expect(message).toHaveClass("max-w-52", "break-words", "text-destructive")
    expect(message).not.toHaveAttribute("title")

    // The row must still expose its actions with a long error present.
    expect(within(row).getByRole("button", { name: /^Actions for/ })).toBeInTheDocument()
  })

  it("deactivates a config only after confirmation, and reactivates without one", async () => {
    renderConfigs()
    await screen.findByText("Morning refresher")

    await clickRowAction(rowFor("Morning refresher"), "Deactivate")
    expect(screen.queryByText(/deactivated/)).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }))
    await expect.poll(() => requests.some((item) => item.url.endsWith("/deactivate"))).toBe(true)

    await userEvent.click(screen.getByRole("button", { name: "Show inactive" }))
    await clickRowAction(rowFor("Old cadence"), "Activate")
    await expect.poll(() => requests.some((item) => item.url.endsWith("cfg2/activate"))).toBe(
      true,
    )
  })
})
