import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { GenerateExamPage } from "@/modules/exams/GenerateExamPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

// The page polls the job every 2s (JOB_POLL_INTERVAL_MS), so any assertion that
// depends on a later poll needs more than testing-library's 1s default.
const POLL_WAIT = 5000

function doc(id: string, title: string, extra: Record<string, unknown> = {}) {
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

function job(extra: Record<string, unknown> = {}) {
  return {
    id: "job1",
    class_id: "cl1",
    status: "queued",
    questions_done: 0,
    num_questions: 10,
    exercise_id: null,
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    finished_at: null,
    ...extra,
  }
}

function renderGenerate(initialEntry = "/admin/classes/cl1/exercises/new") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/admin/classes/:classId/exercises/new" element={<GenerateExamPage />} />
          <Route
            path="/admin/classes/:classId/exercises/:exerciseId"
            element={<p>Editor for {location.pathname}</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("GenerateExamPage", () => {
  let documents: ReturnType<typeof doc>[]
  let posts: unknown[]
  let jobReads: number
  let respond: () => Response
  let jobStates: Record<string, unknown>[]

  beforeEach(() => {
    posts = []
    jobReads = 0
    documents = [doc("d1", "Escalation policy"), doc("d2", "Safety handbook")]
    respond = () => HttpResponse.json(job(), { status: 202 })
    jobStates = [job()]

    server.use(
      http.get(`${API}/api/v1/documents`, () => HttpResponse.json(documents)),
      http.get(`${API}/api/v1/classes`, () =>
        HttpResponse.json([
          {
            id: "cl1",
            name: "Q1 onboarding",
            description: null,
            start_date: null,
            end_date: null,
            created_by: null,
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
          },
        ]),
      ),
      http.post(`${API}/api/v1/exams/generate`, async ({ request }) => {
        posts.push(await request.json())
        return respond()
      }),
      // Walks the sequence, holding on the last state once it runs out.
      http.get(`${API}/api/v1/exams/jobs/:jobId`, () => {
        const state = jobStates[Math.min(jobReads, jobStates.length - 1)]
        jobReads += 1
        return HttpResponse.json(state)
      }),
    )
  })

  async function fillForm() {
    await screen.findByLabelText("Escalation policy")
    await userEvent.type(screen.getByLabelText(/^Title/), "Week 1 check")
    await userEvent.click(screen.getByLabelText("Escalation policy"))
    await userEvent.type(screen.getByLabelText(/^Instructions/), "Cover the sign-offs.")
  }

  it("generates from the picked documents and opens the draft when the job lands", async () => {
    jobStates = [
      job({ status: "running", questions_done: 0 }),
      job({
        status: "succeeded",
        questions_done: 10,
        exercise_id: "ex1",
        finished_at: "2026-01-01T00:01:00Z",
      }),
    ]

    renderGenerate()
    await fillForm()
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({
      title: "Week 1 check",
      class_id: "cl1",
      document_ids: ["d1"],
      num_questions: 10,
      prompt: "Cover the sign-offs.",
    })

    expect(
      await screen.findByText(/Editor for/, undefined, { timeout: POLL_WAIT }),
    ).toBeInTheDocument()
  })

  // Generation is not idempotent and every call bills a real batch of LLM
  // requests, so a second click must not start a second exam.
  it("fires exactly one request however hard the button is pressed", async () => {
    let release: (value: Response) => void = () => {}
    const held = new Promise<Response>((resolve) => {
      release = resolve
    })
    server.use(
      http.post(`${API}/api/v1/exams/generate`, async ({ request }) => {
        posts.push(await request.json())
        return held
      }),
    )

    renderGenerate()
    await fillForm()

    const button = screen.getByRole("button", { name: /Generate exam/ })
    await userEvent.click(button)
    await userEvent.click(button)
    await userEvent.click(button)

    expect(posts).toHaveLength(1)
    release(HttpResponse.json(job(), { status: 202 }))
  })

  it("reports the job's real progress as it advances", async () => {
    jobStates = [
      job({ status: "running", questions_done: 0, num_questions: 25 }),
      job({ status: "running", questions_done: 10, num_questions: 25 }),
      job({ status: "running", questions_done: 20, num_questions: 25 }),
    ]

    renderGenerate()
    await fillForm()
    await userEvent.selectOptions(screen.getByLabelText("Questions"), "25")
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    const bar = await screen.findByRole("progressbar")
    expect(bar).toHaveAttribute("aria-valuemax", "25")

    await waitFor(
      () => expect(bar).toHaveAttribute("aria-valuenow", "10"),
      { timeout: POLL_WAIT },
    )
    expect(screen.getByRole("status")).toHaveTextContent("Writing questions — 10 of 25")

    await waitFor(
      () => expect(bar).toHaveAttribute("aria-valuenow", "20"),
      { timeout: POLL_WAIT },
    )
    expect(screen.getByRole("status")).toHaveTextContent("Writing questions — 20 of 25")
  })

  it("waits without claiming that leaving the page would stop generation", async () => {
    jobStates = [job({ status: "running", questions_done: 0 })]

    renderGenerate()
    await fillForm()
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    const panel = await screen.findByRole("status")
    expect(panel).toHaveAttribute("aria-busy", "true")
    // Leaving is now recoverable, but generation still cannot be cancelled — the
    // worker runs the job to completion either way. Pinned so a later copy edit
    // cannot quietly promise a cancel that does not exist.
    expect(panel).toHaveTextContent(/close this page and come back/)
    expect(panel).toHaveTextContent(/won’t stop if you leave/)
    expect(panel.textContent).not.toMatch(/cancels it|will be cancelled|stops generation/i)
    // The stale-job sweep is promised here, so an admin watching a still bar
    // knows the wait is bounded. Leaving and stalling are different triggers:
    // this must not read as "leaving stops it".
    expect(panel).toHaveTextContent(/won’t run forever either/)
    expect(panel).toHaveTextContent(/if progress stalls, the job is stopped automatically/)
    // The batching limit is stated rather than hidden behind a still bar.
    expect(panel).toHaveTextContent(/batches of ten/)
  })

  // The real failure here is the worker giving up after a long wait, so recovery
  // must not cost the admin the form they filled in.
  it("recovers from a failed job without losing the form", async () => {
    jobStates = [
      job({
        status: "failed",
        error: "Failed to generate questions",
        finished_at: "2026-01-01T00:01:00Z",
      }),
    ]

    renderGenerate()
    await fillForm()
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Failed to generate questions")
    expect(alert).toHaveTextContent(/Nothing was saved/)
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Week 1 check")
    expect(screen.getByLabelText("Escalation policy")).toBeChecked()

    jobStates = [
      job({
        id: "job2",
        status: "succeeded",
        questions_done: 10,
        exercise_id: "ex1",
      }),
    ]
    jobReads = 0
    respond = () => HttpResponse.json(job({ id: "job2" }), { status: 202 })
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))

    await waitFor(() => expect(posts).toHaveLength(2))
    expect(await screen.findByText(/Editor for/)).toBeInTheDocument()
  })

  // The stale-job sweep (worker/tasks.py) fails a job no worker will finish. It
  // arrives as an ordinary failed job, so the existing failure path should carry
  // it with no special handling — this pins that.
  it("surfaces a job failed by the stale-job sweep like any other failure", async () => {
    jobStates = [
      job({ status: "running", questions_done: 0 }),
      job({
        status: "failed",
        error:
          "No worker picked this up within 15 minutes, so it was stopped. " +
          "Check the generation worker is running, then try again.",
        finished_at: "2026-01-01T00:15:00Z",
      }),
    ]

    renderGenerate()
    await fillForm()
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    // Waits first, then the sweep's verdict arrives on a later poll.
    expect(await screen.findByRole("status")).toBeInTheDocument()

    const alert = await screen.findByRole("alert", undefined, { timeout: POLL_WAIT })
    expect(alert).toHaveTextContent(/No worker picked this up within 15 minutes/)
    expect(alert).toHaveTextContent(/Check the generation worker is running/)
    // The panel is gone, so the bar stops polling and the form comes back intact.
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.queryByRole("progressbar")).toBeNull()
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Week 1 check")
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })

  // The sweep can give up on a run that is in fact still alive. The worker's
  // commit is conditional on the job still being "running", so nothing is saved —
  // which is what this panel tells the admin.
  it("promises nothing was saved when a stalled job is swept", async () => {
    jobStates = [
      job({
        status: "failed",
        questions_done: 20,
        num_questions: 50,
        error:
          "Generation stopped responding after 20 of 50 questions and was " +
          "cancelled. Nothing was saved — try again.",
      }),
    ]

    renderGenerate()
    await fillForm()
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    const alert = await screen.findByRole("alert", undefined, { timeout: POLL_WAIT })
    expect(alert).toHaveTextContent(/stopped responding after 20 of 50 questions/)
    expect(alert).toHaveTextContent(/Nothing was saved/)
  })

  // A job the server refuses to hand back is as dead as a failed one — the admin
  // must not be left watching a spinner that will never resolve.
  it("stops waiting when the job cannot be read", async () => {
    server.use(
      http.get(`${API}/api/v1/exams/jobs/:jobId`, () =>
        HttpResponse.json({ detail: "Generation job not found" }, { status: 404 }),
      ),
    )

    renderGenerate()
    await fillForm()
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not read the generation job.",
    )
  })

  // The whole point of putting the job id in the URL: a reload resumes the wait
  // rather than losing it, and must not bill a second generation.
  it("resumes an in-flight job from the URL without posting again", async () => {
    jobStates = [
      job({ status: "running", questions_done: 15, num_questions: 25 }),
    ]

    renderGenerate("/admin/classes/cl1/exercises/new?job=job1")

    const panel = await screen.findByRole("status")
    await waitFor(() =>
      expect(panel).toHaveTextContent("Writing questions — 15 of 25"),
    )
    expect(posts).toHaveLength(0)
  })

  it("navigates to the class the job recorded, not the one in the route", async () => {
    // The admin retargeted the exam to another class before submitting.
    jobStates = [
      job({ status: "succeeded", questions_done: 10, exercise_id: "ex9", class_id: "cl9" }),
    ]

    renderGenerate("/admin/classes/cl1/exercises/new?job=job1")

    expect(
      await screen.findByText(/Editor for/, undefined, { timeout: POLL_WAIT }),
    ).toBeInTheDocument()
  })

  it("blocks a document whose active version is not ready, and says why", async () => {
    documents = [
      doc("d1", "Escalation policy"),
      doc("d2", "Safety handbook", { active_version_processing_status: "processing" }),
      doc("d3", "Old notes", {
        active_version_number: null,
        active_version_processing_status: null,
      }),
    ]

    renderGenerate()
    expect(await screen.findByLabelText("Safety handbook")).toBeDisabled()
    expect(screen.getByLabelText("Safety handbook").closest("label")).toHaveTextContent(
      "Active version is not ready",
    )
    expect(screen.getByLabelText("Old notes")).toBeDisabled()
    expect(screen.getByLabelText("Old notes").closest("label")).toHaveTextContent(
      "No active version",
    )
    expect(screen.getByLabelText("Escalation policy")).toBeEnabled()
  })

  it("stops at ten documents", async () => {
    documents = Array.from({ length: 12 }, (_, i) => doc(`d${i}`, `Doc ${i}`))

    renderGenerate()
    await screen.findByLabelText("Doc 0")
    for (let i = 0; i < 10; i++) {
      await userEvent.click(screen.getByLabelText(`Doc ${i}`))
    }

    expect(screen.getByText(/of 10 selected — the limit/)).toBeInTheDocument()
    expect(screen.getByLabelText("Doc 10")).toBeDisabled()
    // Deselecting is still allowed at the limit, otherwise the choice is stuck.
    expect(screen.getByLabelText("Doc 9")).toBeEnabled()
  })

  it("asks for documents before spending a request", async () => {
    renderGenerate()
    await screen.findByLabelText("Escalation policy")
    await userEvent.type(screen.getByLabelText(/^Title/), "Week 1 check")
    await userEvent.type(screen.getByLabelText(/^Instructions/), "Cover the sign-offs.")
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    expect(await screen.findByText("Choose at least one document.")).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  it("picks a question count from the preset list", async () => {
    renderGenerate()
    await fillForm()
    await userEvent.selectOptions(screen.getByLabelText("Questions"), "25")
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect((posts[0] as Record<string, unknown>).num_questions).toBe(25)
    // A preset needs no free-text box.
    expect(screen.queryByLabelText("Number of questions")).toBeNull()
  })

  it("reveals a number input for a count outside the presets", async () => {
    renderGenerate()
    await fillForm()
    await userEvent.selectOptions(screen.getByLabelText("Questions"), "custom")

    const custom = screen.getByLabelText("Number of questions")
    await userEvent.clear(custom)
    await userEvent.type(custom, "7")
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect((posts[0] as Record<string, unknown>).num_questions).toBe(7)
  })

  it("rejects a custom count the server would reject", async () => {
    renderGenerate()
    await fillForm()
    await userEvent.selectOptions(screen.getByLabelText("Questions"), "custom")

    const custom = screen.getByLabelText("Number of questions")
    await userEvent.clear(custom)
    await userEvent.type(custom, "80")
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    expect(
      await screen.findByText("Enter a whole number between 1 and 50."),
    ).toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  // The class is required and pre-filled from the route, so there must be no way
  // back to an empty selection.
  it("offers no empty option on the pre-filled class picker", async () => {
    renderGenerate()
    await screen.findByLabelText("Escalation policy")

    const picker = screen.getByLabelText("Class")
    expect(picker).toHaveValue("cl1")
    expect(
      Array.from(picker.querySelectorAll("option")).map((o) => o.value),
    ).toEqual(["cl1"])
    expect(screen.queryByRole("option", { name: "Choose one" })).toBeNull()
  })

  it("treats instructions as optional and generates with an empty prompt", async () => {
    renderGenerate()
    await screen.findByLabelText("Escalation policy")
    await userEvent.type(screen.getByLabelText("Title"), "Week 1 check")
    await userEvent.click(screen.getByLabelText("Escalation policy"))
    // Instructions left untouched.
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect((posts[0] as Record<string, unknown>).prompt).toBe("")
  })

  it("marks instructions optional and leaves the required fields unmarked", async () => {
    renderGenerate()
    await screen.findByLabelText("Escalation policy")

    expect(screen.getByLabelText("Instructions (optional)")).toBeInTheDocument()
    expect(screen.getByLabelText("Title")).toBeInTheDocument()
    expect(screen.getByLabelText("Class")).toBeInTheDocument()
    expect(screen.queryByText("*")).toBeNull()
  })
})
