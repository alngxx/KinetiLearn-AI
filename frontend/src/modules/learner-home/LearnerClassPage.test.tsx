import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LearnerChatContext } from "@/layouts/LearnerLayout"
import { startDownload } from "@/lib/download"
import { LearnerClassPage } from "@/modules/learner-home/LearnerClassPage"
import { server } from "@/test/server"

// jsdom implements no navigation, and the real helper's whole job is to
// navigate. Mocked so the call can be asserted on instead.
vi.mock("@/lib/download", () => ({ startDownload: vi.fn() }))

const API = "http://localhost:8000"

function exercise(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    description: null,
    start_time: "2026-08-01T09:00:00Z",
    end_time: "2026-09-03T17:00:00Z",
    duration_minutes: 30,
    pass_score: 70,
    total_points: 100,
    question_count: 10,
    attempt_count: 0,
    best_score: null,
    is_passed: null,
    skill_names: [],
    ...extra,
  }
}

// Stands in for LearnerLayout, which is what actually supplies this context in
// production — LearnerClassPage reads it via useOutletContext to drive the
// layout-owned chat panel.
function LayoutStub({ openClassChat }: LearnerChatContext) {
  return <Outlet context={{ openClassChat } satisfies LearnerChatContext} />
}

function renderClass(
  exercises: unknown[],
  classes: unknown[] = [],
  status = 200,
  submissions: unknown[] = [],
  {
    documents = [] as unknown[],
    classChats = [] as unknown[],
    openClassChat = vi.fn(),
  }: {
    documents?: unknown[]
    classChats?: unknown[]
    openClassChat?: LearnerChatContext["openClassChat"]
  } = {},
) {
  server.use(
    http.get(`${API}/api/v1/classes/me`, () => HttpResponse.json(classes)),
    http.get(`${API}/api/v1/submissions/me`, () => HttpResponse.json(submissions)),
    http.get(`${API}/api/v1/classes/cl1/exercises`, () =>
      status === 200
        ? HttpResponse.json(exercises)
        : HttpResponse.json({ detail: "You are not a member of this class." }, { status }),
    ),
    http.get(`${API}/api/v1/classes/cl1/documents`, () => HttpResponse.json(documents)),
    http.get(`${API}/api/v1/chat/sessions`, () => HttpResponse.json(classChats)),
  )

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/learner/classes/cl1"]}>
        <Routes>
          <Route element={<LayoutStub openClassChat={openClassChat} />}>
            <Route path="/learner/classes/:classId" element={<LearnerClassPage />} />
          </Route>
          <Route path="/learner" element={<p>Home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function submission(id: string, exerciseId: string, score: number, attempt: number) {
  return {
    id,
    user_id: "u1",
    exercise_id: exerciseId,
    attempt_number: attempt,
    submitted_at: "2026-08-20T10:00:00Z",
    score,
    is_passed: score >= 70,
    is_late: false,
  }
}

function cardFor(title: string) {
  return screen.getByRole("heading", { name: title }).closest("article") as HTMLElement
}

describe("LearnerClassPage", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API}/api/v1/classes/me`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/submissions/me`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/classes/cl1/documents`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/chat/sessions`, () => HttpResponse.json([])),
    )
  })

  it("shows an attempted exercise with its score and result", async () => {
    renderClass([
      exercise("ex1", "Data handling basics", {
        attempt_count: 1,
        best_score: 80,
        is_passed: true,
        skill_names: ["Compliance", "Security"],
      }),
    ])

    await screen.findByRole("heading", { name: "Data handling basics" })
    const card = cardFor("Data handling basics")

    expect(within(card).getByText("Passed")).toBeInTheDocument()
    expect(within(card).getByText("80")).toBeInTheDocument()
    expect(within(card).getByText("10")).toBeInTheDocument()
    expect(within(card).getByText("Compliance")).toBeInTheDocument()
    expect(within(card).getByText("Security")).toBeInTheDocument()
  })

  // A multi-document exam awards no skill points, so an empty list is a real
  // answer and must not render an empty label.
  it("renders no skills at all when the exercise promises none", async () => {
    renderClass([exercise("ex1", "Incident reporting")])

    await screen.findByRole("heading", { name: "Incident reporting" })
    const card = cardFor("Incident reporting")

    expect(within(card).getByText("—")).toBeInTheDocument()
    expect(within(card).queryByRole("list")).not.toBeInTheDocument()
  })

  it("offers Start on an exercise nobody has attempted, and no past result to open", async () => {
    renderClass([exercise("ex1", "Incident reporting")])

    await screen.findByRole("heading", { name: "Incident reporting" })
    const card = cardFor("Incident reporting")

    expect(within(card).getByRole("link", { name: "Start" })).toHaveAttribute(
      "href",
      "/learner/exams/ex1/take",
    )
    expect(within(card).queryByRole("link", { name: /best attempt/ })).not.toBeInTheDocument()
  })

  it("calls it Try again once there is an attempt, and links to the best one", async () => {
    renderClass(
      [exercise("ex1", "Incident reporting", { attempt_count: 2, best_score: 80 })],
      [],
      200,
      // Newest first, as the server orders them. The best attempt is the older,
      // higher-scoring one — the same number the card shows as Best.
      [
        submission("sub2", "ex1", 55, 2),
        submission("sub1", "ex1", 80, 1),
      ],
    )

    await screen.findByRole("heading", { name: "Incident reporting" })
    const card = cardFor("Incident reporting")

    expect(within(card).getByRole("link", { name: "Try again" })).toBeInTheDocument()
    expect(within(card).getByRole("link", { name: "See your best attempt" })).toHaveAttribute(
      "href",
      "/learner/exams/ex1/result/sub1",
    )
  })

  // The list is only there to link a past result. Losing it must not cost the
  // learner the exercises or the ability to start one.
  it("still offers Start when the submission list fails", async () => {
    renderClass([exercise("ex1", "Incident reporting")])
    server.use(
      http.get(`${API}/api/v1/submissions/me`, () =>
        HttpResponse.json({ detail: "Nope." }, { status: 500 }),
      ),
    )

    await screen.findByRole("heading", { name: "Incident reporting" })
    const card = cardFor("Incident reporting")

    expect(within(card).getByRole("link", { name: "Start" })).toBeInTheDocument()
    expect(within(card).queryByRole("link", { name: /best attempt/ })).not.toBeInTheDocument()
  })

  it("surfaces the server's own message when the learner is not a member", async () => {
    renderClass([], [], 403)
    expect(await screen.findByText("You are not a member of this class.")).toBeInTheDocument()
  })

  it("shows an empty state when the class has no exercises", async () => {
    renderClass([])
    expect(await screen.findByText("No exercises yet")).toBeInTheDocument()
  })

  it("titles the page from the learner's own class list", async () => {
    renderClass(
      [exercise("ex1", "Incident reporting")],
      [
        {
          id: "cl1",
          name: "Q1 onboarding",
          description: null,
          start_date: null,
          end_date: null,
          enrolled_at: "2026-03-02T09:00:00Z",
          exercise_count: 1,
          completed_exercise_count: 0,
        },
      ],
    )

    expect(await screen.findByRole("heading", { name: "Q1 onboarding", level: 1 })).toBeInTheDocument()
  })

  function document(
    id: string,
    title: string,
    categoryName: string | null,
    format: string,
  ) {
    return { id, title, category_name: categoryName, format }
  }

  function chatSession(id: string, classId: string) {
    return {
      id,
      exercise_id: null,
      class_id: classId,
      document_id: null,
      title: "Studying for the exam",
      is_active: true,
      created_at: "2026-08-27T09:00:00Z",
      updated_at: "2026-08-27T09:00:00Z",
    }
  }

  it("lists materials grouped by category, with format", async () => {
    renderClass([], [], 200, [], {
      documents: [
        document("d1", "Leave handbook", "Compliance", "PDF"),
        document("d2", "Onboarding checklist", "Compliance", "DOCX"),
        document("d3", "Loose notes", null, "MD"),
      ],
    })

    expect(await screen.findByText("Leave handbook")).toBeInTheDocument()
    expect(screen.getByText("Onboarding checklist")).toBeInTheDocument()
    expect(screen.getByText("Loose notes")).toBeInTheDocument()
    expect(screen.getByText("Compliance")).toBeInTheDocument()
    expect(screen.getByText("PDF")).toBeInTheDocument()
    expect(screen.getByText("DOCX")).toBeInTheDocument()
    expect(screen.getByText("MD")).toBeInTheDocument()

    // The row carries no URL of its own — downloading goes through the
    // membership-checked endpoint, which mints one per click.
    expect(screen.queryByRole("link", { name: /Leave handbook/ })).not.toBeInTheDocument()
  })

  it("shows an empty state when the class has no materials", async () => {
    renderClass([], [], 200, [], { documents: [] })
    expect(await screen.findByText("No materials yet")).toBeInTheDocument()
  })

  it("offers to start studying when no class chat exists yet, and starts one on click", async () => {
    const openClassChat = vi.fn()
    renderClass([], [], 200, [], { classChats: [], openClassChat })

    const button = await screen.findByRole("button", { name: "Study with AI mentor" })
    expect(screen.queryByRole("button", { name: "Resume studying" })).not.toBeInTheDocument()

    await userEvent.click(button)
    expect(openClassChat).toHaveBeenCalledWith("cl1", null)
  })

  it("offers to resume when a class chat already exists, and resumes it on click", async () => {
    const openClassChat = vi.fn()
    renderClass([], [], 200, [], {
      classChats: [chatSession("sess1", "cl1")],
      openClassChat,
    })

    const button = await screen.findByRole("button", { name: "Resume studying" })
    expect(screen.queryByRole("button", { name: "Study with AI mentor" })).not.toBeInTheDocument()

    await userEvent.click(button)
    expect(openClassChat).toHaveBeenCalledWith("cl1", "sess1")
  })

  describe("downloading a material", () => {
    const SIGNED = "https://r2.example.com/documents/d1/v1.pdf?X-Amz-Signature=abc"

    beforeEach(() => {
      vi.mocked(startDownload).mockClear()
    })

    function withDocument() {
      renderClass([], [], 200, [], {
        documents: [document("d1", "Leave handbook", "Compliance", "PDF")],
      })
    }

    it("names the button for the document it downloads", async () => {
      withDocument()
      // Not "Download" on its own — that repeats once per row and tells a
      // screen reader nothing about which file it would fetch.
      expect(
        await screen.findByRole("button", { name: "Download Leave handbook" }),
      ).toBeInTheDocument()
    })

    it("asks the class-scoped endpoint for a URL and hands it to the browser", async () => {
      let requested: string | null = null
      server.use(
        http.get(`${API}/api/v1/classes/:classId/documents/:documentId/download`, ({ request }) => {
          requested = new URL(request.url).pathname
          return HttpResponse.json({ url: SIGNED, expires_in: 300 })
        }),
      )
      withDocument()

      await userEvent.click(
        await screen.findByRole("button", { name: "Download Leave handbook" }),
      )

      await waitFor(() => expect(startDownload).toHaveBeenCalledWith(SIGNED))
      // Both ids come from the route and the row, so a document can only ever
      // be asked for under the class it is shown in.
      expect(requested).toBe("/api/v1/classes/cl1/documents/d1/download")
    })

    it("shows the server's own message when the download is refused", async () => {
      server.use(
        http.get(`${API}/api/v1/classes/:classId/documents/:documentId/download`, () =>
          HttpResponse.json({ detail: "You are not a member of this class." }, { status: 403 }),
        ),
      )
      withDocument()

      await userEvent.click(
        await screen.findByRole("button", { name: "Download Leave handbook" }),
      )

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "You are not a member of this class.",
      )
      expect(startDownload).not.toHaveBeenCalled()
      // The page is still there, and the button is usable again.
      expect(screen.getByText("Leave handbook")).toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Download Leave handbook" }),
      ).toBeEnabled()
    })

    it("surfaces a 404 the same way, without crashing the page", async () => {
      server.use(
        http.get(`${API}/api/v1/classes/:classId/documents/:documentId/download`, () =>
          HttpResponse.json({ detail: "Document not found." }, { status: 404 }),
        ),
      )
      withDocument()

      await userEvent.click(
        await screen.findByRole("button", { name: "Download Leave handbook" }),
      )

      expect(await screen.findByRole("alert")).toHaveTextContent("Document not found.")
      expect(screen.getByText("Leave handbook")).toBeInTheDocument()
    })

    it("disables the button while the URL is being minted", async () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      server.use(
        http.get(`${API}/api/v1/classes/:classId/documents/:documentId/download`, async () => {
          await gate
          return HttpResponse.json({ url: SIGNED, expires_in: 300 })
        }),
      )
      withDocument()

      const button = await screen.findByRole("button", { name: "Download Leave handbook" })
      await userEvent.click(button)

      await waitFor(() => expect(button).toBeDisabled())
      // The spin alone is invisible to a screen reader, so the name carries
      // the state too.
      expect(button).toHaveAccessibleName("Downloading Leave handbook")

      release()
      await waitFor(() => expect(startDownload).toHaveBeenCalledWith(SIGNED))
      await waitFor(() => expect(button).toBeEnabled())
      expect(button).toHaveAccessibleName("Download Leave handbook")
    })
  })
})
