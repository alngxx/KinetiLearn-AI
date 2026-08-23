import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { Toaster } from "sonner"
import { beforeEach, describe, expect, it } from "vitest"
import { ExerciseDetailPage } from "@/modules/exams/ExerciseDetailPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

type Option = { id: string; option_label: string; option_text: string; is_correct: boolean }
type Question = {
  id: string
  question_text: string
  explanation: string | null
  points: number
  order_index: number
  options: Option[]
}

function question(id: string, text: string, order: number): Question {
  return {
    id,
    question_text: text,
    explanation: "Because the policy says so.",
    points: 1,
    order_index: order,
    options: ["A", "B", "C", "D"].map((label, i) => ({
      id: `${id}-${label}`,
      option_label: label,
      option_text: `${label} answer`,
      is_correct: i === 0,
    })),
  }
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/classes/cl1/exercises/ex1"]}>
        <Routes>
          <Route
            path="/admin/classes/:classId/exercises/:exerciseId"
            element={<ExerciseDetailPage />}
          />
          <Route path="/admin/classes/:classId" element={<p>Class page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// A blocked unpublish says why only through a toast, so this variant mounts
// one. sonner's own Toaster is used rather than the app wrapper, which only
// adds theming.
function renderDetailWithToasts() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/classes/cl1/exercises/ex1"]}>
        <Routes>
          <Route
            path="/admin/classes/:classId/exercises/:exerciseId"
            element={<ExerciseDetailPage />}
          />
          <Route path="/admin/classes/:classId" element={<p>Class page</p>} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  )
}

describe("ExerciseDetailPage", () => {
  let exercise: Record<string, unknown>
  let questions: Question[]
  let writes: { url: string; body: unknown }[]
  let failOption: string | null
  let unpublishStatus: number
  let unpublishDetail: string

  beforeEach(() => {
    failOption = null
    writes = []
    unpublishStatus = 200
    unpublishDetail = ""
    questions = [question("q1", "Who signs off a level 2?", 0), question("q2", "When?", 1)]
    exercise = {
      id: "ex1",
      title: "Week 1 check",
      description: null,
      class_id: "cl1",
      is_active: false,
      start_time: "2026-03-02T09:00:00.000Z",
      end_time: "2026-03-06T17:00:00.000Z",
      duration_minutes: 60,
      pass_score: 0,
      total_points: 2,
      questions,
      chunks_used: 12,
      chunks_total: 40,
    }

    server.use(
      http.get(`${API}/api/v1/exams/ex1`, () =>
        HttpResponse.json({ ...exercise, questions }),
      ),
      http.patch(
        `${API}/api/v1/exams/questions/:questionId/options/:optionId`,
        async ({ request, params }) => {
          const body = (await request.json()) as Record<string, unknown>
          writes.push({ url: request.url, body })
          if (params.optionId === failOption) {
            return HttpResponse.json({ detail: "Option text is too long" }, { status: 400 })
          }
          const target = questions.find((item) => item.id === params.questionId)!
          const option = target.options.find((item) => item.id === params.optionId)!
          if (typeof body.option_text === "string") option.option_text = body.option_text
          // Same radio behaviour the service has: setting one clears the rest.
          if (body.is_correct === true) {
            for (const each of target.options) each.is_correct = each.id === option.id
          }
          return HttpResponse.json(target)
        },
      ),
      http.patch(`${API}/api/v1/exams/questions/:questionId`, async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>
        writes.push({ url: request.url, body })
        const target = questions.find((item) => item.id === params.questionId)!
        Object.assign(target, body)
        return HttpResponse.json(target)
      }),
      http.put(`${API}/api/v1/exams/ex1/finalize`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        writes.push({ url: request.url, body })
        exercise = { ...exercise, ...body, is_active: true }
        return HttpResponse.json({ ...exercise, questions })
      }),
      http.delete(`${API}/api/v1/exams/ex1`, ({ request }) => {
        writes.push({ url: request.url, body: null })
        return HttpResponse.json({ deleted: 1 })
      }),
      http.patch(`${API}/api/v1/exams/ex1`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        writes.push({ url: request.url, body })
        if ((exercise as Record<string, unknown>).is_active === true) {
          return HttpResponse.json(
            { detail: "Cannot edit a finalized exercise" },
            { status: 409 },
          )
        }
        exercise = { ...exercise, ...body }
        return HttpResponse.json({ ...exercise, questions })
      }),
      http.patch(`${API}/api/v1/exams/ex1/unpublish`, ({ request }) => {
        writes.push({ url: request.url, body: null })
        if (unpublishStatus !== 200) {
          return HttpResponse.json({ detail: unpublishDetail }, { status: unpublishStatus })
        }
        exercise = { ...exercise, is_active: false }
        return HttpResponse.json({ ...exercise, questions })
      }),
    )
  })

  async function openFirstQuestion() {
    await screen.findByRole("heading", { name: "Week 1 check" })
    await userEvent.click(screen.getByRole("button", { name: /Who signs off a level 2/ }))
  }

  // Four separate PATCHes with no transaction behind them. When one fails the
  // screen has to say which of the others landed, or the admin cannot tell what
  // is on the server.
  async function makeFourChanges() {
    await userEvent.type(screen.getByLabelText("Question"), " exactly?")
    await userEvent.clear(screen.getByLabelText("Option A text"))
    await userEvent.type(screen.getByLabelText("Option A text"), "The duty manager")
    await userEvent.clear(screen.getByLabelText("Option B text"))
    await userEvent.type(screen.getByLabelText("Option B text"), "The shift lead")
    await userEvent.click(screen.getByLabelText("C"))
  }

  it("reports which parts of a half-failed save actually landed", async () => {
    failOption = "q1-B"

    renderDetail()
    await openFirstQuestion()
    await makeFourChanges()
    await userEvent.click(screen.getByRole("button", { name: "Save question" }))

    const summary = within(await screen.findByRole("alert"))
    expect(summary.getByText("Partly saved")).toBeInTheDocument()

    const line = (label: RegExp) => summary.getByText(label).closest("li")
    expect(line(/question text/)).toHaveTextContent("question text — saved")
    expect(line(/Option A text/)).toHaveTextContent("Option A text — saved")
    expect(line(/Option B text/)).toHaveTextContent(
      "Option B text — Option text is too long",
    )
    // The answer key is written last on purpose, so a failure before it leaves
    // the key untouched rather than pointing at text that never saved.
    expect(line(/Correct answer/)).toHaveTextContent("Correct answer — not attempted")

    // Stopped at the failure: the correct-answer write was never sent.
    expect(writes).toHaveLength(3)
    expect(writes.some((write) => write.body !== null && "is_correct" in (write.body as object)))
      .toBe(false)

    // Still open and not reported as saved.
    expect(screen.getByLabelText("Question")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry unsaved changes" })).toBeInTheDocument()
  })

  it("retries only the parts that did not save", async () => {
    failOption = "q1-B"

    renderDetail()
    await openFirstQuestion()
    await makeFourChanges()
    await userEvent.click(screen.getByRole("button", { name: "Save question" }))
    await screen.findByRole("button", { name: "Retry unsaved changes" })

    failOption = null
    writes = []
    await userEvent.click(screen.getByRole("button", { name: "Retry unsaved changes" }))

    // Only the failed step and the one it blocked — the two that already saved
    // are not written a second time.
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(writes[0].url).toContain("/options/q1-B")
    expect(writes[1].body).toEqual({ is_correct: true })
    // Success collapses the card.
    await waitFor(() => expect(screen.queryByLabelText("Question")).toBeNull())
  })

  it("reports a save that landed nothing as a plain failure, not a breakdown", async () => {
    renderDetail()
    await openFirstQuestion()
    await userEvent.clear(screen.getByLabelText("Option A text"))
    await userEvent.type(screen.getByLabelText("Option A text"), "The duty manager")
    failOption = "q1-A"
    await userEvent.click(screen.getByRole("button", { name: "Save question" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Option text is too long")
    expect(screen.queryByText("Partly saved")).toBeNull()
  })

  // The safety boundary of this screen: delete stays draft-only even though
  // unpublish now exists, since a published exam can have submissions the
  // database refuses to orphan.
  it("offers delete on a draft", async () => {
    renderDetail()
    expect(await screen.findByRole("button", { name: /Delete draft/ })).toBeInTheDocument()
  })

  it("does not offer delete once the exam is live", async () => {
    exercise = { ...exercise, is_active: true }

    renderDetail()
    await screen.findByRole("heading", { name: "Week 1 check" })
    expect(screen.queryByRole("button", { name: /Delete draft/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Finalize/ })).toBeNull()
  })

  it("locks the questions once the exam is live", async () => {
    exercise = { ...exercise, is_active: true }

    renderDetail()
    await openFirstQuestion()
    expect(screen.queryByLabelText("Question")).toBeNull()
    expect(screen.queryByRole("button", { name: "Save question" })).toBeNull()
    expect(screen.getByText(/Learners may already have answered them/)).toBeInTheDocument()
  })

  it("deletes a draft after confirmation and returns to the class", async () => {
    renderDetail()
    await userEvent.click(await screen.findByRole("button", { name: /Delete draft/ }))
    await userEvent.click(await screen.findByRole("button", { name: "Delete draft", hidden: false }))

    await waitFor(() => expect(screen.getByText("Class page")).toBeInTheDocument())
    expect(writes.some((write) => write.url.endsWith("/exams/ex1"))).toBe(true)
  })

  it("blocks a pass mark above the live points total without calling the API", async () => {
    renderDetail()
    await userEvent.click(await screen.findByRole("button", { name: /Finalize/ }))
    const dialog = within(await screen.findByRole("dialog"))

    const pass = dialog.getByLabelText(/^Pass mark/)
    await userEvent.clear(pass)
    await userEvent.type(pass, "5")
    await userEvent.click(dialog.getByRole("button", { name: "Finalize and publish" }))

    expect(await dialog.findByText("pass_score cannot exceed total_points")).toBeInTheDocument()
    expect(writes).toHaveLength(0)
  })

  it("finalizes with the schedule the admin set", async () => {
    renderDetail()
    await userEvent.click(await screen.findByRole("button", { name: /Finalize/ }))
    const dialog = within(await screen.findByRole("dialog"))

    const pass = dialog.getByLabelText(/^Pass mark/)
    await userEvent.clear(pass)
    await userEvent.type(pass, "2")
    await userEvent.click(dialog.getByRole("button", { name: "Finalize and publish" }))

    await waitFor(() => expect(writes).toHaveLength(1))
    const body = writes[0].body as Record<string, unknown>
    expect(body.pass_score).toBe(2)
    expect(body.duration_minutes).toBe(60)
    // Sent as a real instant, not the zoneless value the input carries.
    expect(new Date(body.start_time as string).toISOString()).toBe(body.start_time)
  })

  it("renames a draft and shows the new title", async () => {
    renderDetail()
    await userEvent.click(await screen.findByRole("button", { name: /Rename/ }))
    const dialog = within(await screen.findByRole("dialog"))

    const input = dialog.getByLabelText("Title")
    expect(input).toHaveValue("Week 1 check")
    await userEvent.clear(input)
    await userEvent.type(input, "Week 1 assessment")
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].body).toEqual({ title: "Week 1 assessment" })
    expect(
      await screen.findByRole("heading", { name: "Week 1 assessment" }),
    ).toBeInTheDocument()
  })

  it("blocks an empty title without calling the API", async () => {
    renderDetail()
    await userEvent.click(await screen.findByRole("button", { name: /Rename/ }))
    const dialog = within(await screen.findByRole("dialog"))

    await userEvent.clear(dialog.getByLabelText("Title"))
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))

    expect(await dialog.findByText("Title is required.")).toBeInTheDocument()
    expect(writes).toHaveLength(0)
  })

  // Renaming follows the same rule as the question edits: a live exam's wording
  // is not the admin's to change any more.
  it("does not offer rename once the exam is live", async () => {
    exercise = { ...exercise, is_active: true }

    renderDetail()
    await screen.findByRole("heading", { name: "Week 1 check" })
    expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull()
  })

  it("says how much of the source material was actually read", async () => {
    renderDetail()
    expect(await screen.findByText(/source sections were read/)).toHaveTextContent(
      "12 of 40 source sections were read",
    )
    expect(screen.getByText(/The rest did not fit/)).toBeInTheDocument()
  })

  it("does not offer unpublish on a draft", async () => {
    renderDetail()
    await screen.findByRole("heading", { name: "Week 1 check" })
    expect(screen.queryByRole("button", { name: /Unpublish/ })).toBeNull()
  })

  it("unpublishes a live exam that has not opened yet, after confirming", async () => {
    exercise = { ...exercise, is_active: true, start_time: "2030-01-01T00:00:00.000Z" }

    renderDetail()
    const unpublishButton = await screen.findByRole("button", { name: /Unpublish/ })
    expect(unpublishButton).toBeEnabled()

    await userEvent.click(unpublishButton)
    const dialog = within(await screen.findByRole("alertdialog"))
    // Worded as a real state change, distinct from the delete confirm's wording.
    expect(dialog.getByText(/back to Draft/)).toBeInTheDocument()
    await userEvent.click(dialog.getByRole("button", { name: "Unpublish" }))

    await waitFor(() => expect(screen.getByText("Draft")).toBeInTheDocument())
    expect(writes.some((write) => write.url.endsWith("/exams/ex1/unpublish"))).toBe(true)
    // Finalize and delete-draft return once it is a draft again.
    expect(screen.getByRole("button", { name: /Finalize/ })).toBeInTheDocument()
  })

  it("disables unpublish once the exam has already opened, and explains why", async () => {
    exercise = { ...exercise, is_active: true, start_time: "2020-01-01T00:00:00.000Z" }

    renderDetail()
    const unpublishButton = await screen.findByRole("button", { name: /Unpublish/ })

    expect(unpublishButton).toBeDisabled()
    expect(
      screen.getByText(/Only an exam that has not opened yet can be unpublished/),
    ).toBeInTheDocument()
    expect(writes.some((write) => write.url.endsWith("/unpublish"))).toBe(false)
  })

  it("keeps the exam live and shows the server's reason when unpublish is blocked", async () => {
    exercise = { ...exercise, is_active: true, start_time: "2030-01-01T00:00:00.000Z" }
    unpublishStatus = 409
    unpublishDetail = "Cannot unpublish an exercise that has submissions."

    renderDetailWithToasts()
    await userEvent.click(await screen.findByRole("button", { name: /Unpublish/ }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unpublish" }),
    )

    // Verbatim: the sentence names the actual reason, which a generic
    // "could not unpublish" would throw away.
    expect(await screen.findByText(unpublishDetail)).toBeInTheDocument()
    expect(screen.getByText("Live")).toBeInTheDocument()
  })
})
