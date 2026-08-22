import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
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

describe("ExerciseDetailPage", () => {
  let exercise: Record<string, unknown>
  let questions: Question[]
  let writes: { url: string; body: unknown }[]
  let failOption: string | null

  beforeEach(() => {
    failOption = null
    writes = []
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

  // The safety boundary of this screen. A published exam can have submissions,
  // which the database refuses to orphan, and there is no un-publish.
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

  it("says how much of the source material was actually read", async () => {
    renderDetail()
    expect(await screen.findByText(/source sections were read/)).toHaveTextContent(
      "12 of 40 source sections were read",
    )
    expect(screen.getByText(/The rest did not fit/)).toBeInTheDocument()
  })
})
