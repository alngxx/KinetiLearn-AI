import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { GenerateExamPage } from "@/modules/exams/GenerateExamPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"

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

function renderGenerate() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/classes/cl1/exercises/new"]}>
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
  let respond: () => Response

  beforeEach(() => {
    posts = []
    documents = [doc("d1", "Escalation policy"), doc("d2", "Safety handbook")]
    respond = () =>
      HttpResponse.json(
        { id: "ex1", title: "Q", class_id: "cl1", is_active: false, questions: [] },
        { status: 201 },
      )

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
    )
  })

  async function fillForm() {
    await screen.findByLabelText("Escalation policy")
    await userEvent.type(screen.getByLabelText(/^Title/), "Week 1 check")
    await userEvent.click(screen.getByLabelText("Escalation policy"))
    await userEvent.type(screen.getByLabelText(/^Instructions/), "Cover the sign-offs.")
  }

  it("generates from the picked documents and opens the draft", async () => {
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
    release(
      HttpResponse.json(
        { id: "ex1", title: "Q", class_id: "cl1", is_active: false, questions: [] },
        { status: 201 },
      ),
    )
  })

  it("waits without claiming that leaving the page would stop generation", async () => {
    server.use(
      http.post(`${API}/api/v1/exams/generate`, async ({ request }) => {
        posts.push(await request.json())
        return new Promise<Response>(() => {})
      }),
    )

    renderGenerate()
    await fillForm()
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    const panel = await screen.findByRole("status")
    expect(panel).toHaveAttribute("aria-busy", "true")
    expect(panel).toHaveTextContent(/Writing 10 questions from 1 document/)
    // The server has no disconnect check, so the reassuring version of this
    // sentence would be false. Pinned so a later copy edit cannot restore it.
    expect(panel).toHaveTextContent(/Leaving this page won’t stop generation/)
    expect(panel).toHaveTextContent(/find it as a draft on the class page/)
    expect(panel.textContent).not.toMatch(/cancels it|will be cancelled|stops generation/i)
  })

  // The real failure here is a 502 out of the LLM wrapper after a long wait, so
  // recovery must not cost the admin the form they filled in.
  it("recovers from a failed generation without losing the form", async () => {
    respond = () =>
      HttpResponse.json({ detail: "Failed to generate questions" }, { status: 502 })

    renderGenerate()
    await fillForm()
    await userEvent.click(screen.getByRole("button", { name: /Generate exam/ }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Failed to generate questions")
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByLabelText(/^Title/)).toHaveValue("Week 1 check")
    expect(screen.getByLabelText("Escalation policy")).toBeChecked()

    respond = () =>
      HttpResponse.json(
        { id: "ex1", title: "Q", class_id: "cl1", is_active: false, questions: [] },
        { status: 201 },
      )
    await userEvent.click(screen.getByRole("button", { name: "Try again" }))

    await waitFor(() => expect(posts).toHaveLength(2))
    expect(await screen.findByText(/Editor for/)).toBeInTheDocument()
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
