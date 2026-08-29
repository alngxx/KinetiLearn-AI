import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { clickRowAction } from "@/test/rowActions"
import { http, HttpResponse } from "msw"
import { Toaster } from "sonner"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it } from "vitest"
import { DocumentsPage } from "@/modules/documents/DocumentsPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"
const PDF_MIME = "application/pdf"

function doc(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    document_id: id,
    title,
    category_id: "c1",
    active_version_number: 1,
    is_active: true,
    active_version_processing_status: "ready",
    skill_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

function lookup(id: string, name: string) {
  return { id, name, description: null, is_active: true, created_at: "2026-01-01T00:00:00Z" }
}

function pdf(name = "handbook.pdf") {
  return new File(["pdf bytes"], name, { type: PDF_MIME })
}

function renderDocuments(initialPath = "/admin/documents") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/admin/documents" element={<DocumentsPage />} />
          <Route path="/admin/documents/:documentId" element={<p>Detail for a document</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("DocumentsPage", () => {
  let documents: ReturnType<typeof doc>[]
  let uploads: { type: string | null }[]

  beforeEach(() => {
    documents = [
      doc("d1", "Safety handbook", { skill_ids: ["s1"] }),
      doc("d2", "Onboarding guide", { active_version_processing_status: "processing" }),
    ]
    uploads = []

    server.use(
      http.get(`${API}/api/v1/config/categories`, () =>
        HttpResponse.json([lookup("c1", "Operations")]),
      ),
      http.get(`${API}/api/v1/config/skills`, () => HttpResponse.json([lookup("s1", "Fire safety")])),
      http.get(`${API}/api/v1/documents`, () => HttpResponse.json(documents)),
      // The body is deliberately left unread: jsdom's File cannot be streamed
      // back out by msw, so touching it here would hang the request. What the
      // form actually carries is covered by buildUploadForm in api.test.ts.
      http.post(`${API}/api/v1/documents/upload`, ({ request }) => {
        uploads.push({ type: request.headers.get("Content-Type") })
        return HttpResponse.json(
          { document_id: "d3", version_number: 1, processing_status: "pending" },
          { status: 201 },
        )
      }),
    )
  })

  it("lists documents with their category, tags and processing state", async () => {
    renderDocuments()

    expect(await screen.findByRole("link", { name: "Safety handbook" })).toBeInTheDocument()
    const row = screen.getByRole("row", { name: /Safety handbook/ })
    expect(within(row).getByText("Operations")).toBeInTheDocument()
    expect(within(row).getByText("Fire safety")).toBeInTheDocument()
    expect(within(row).getByText("Ready")).toBeInTheDocument()

    const processing = screen.getByRole("row", { name: /Onboarding guide/ })
    expect(within(processing).getByText("Processing")).toBeInTheDocument()
  })

  it("uploads a file as multipart and lands on the new document", async () => {
    renderDocuments()
    await screen.findByRole("link", { name: "Safety handbook" })

    await userEvent.click(screen.getByRole("button", { name: /Upload document/ }))
    const dialog = within(screen.getByRole("dialog"))
    await userEvent.upload(dialog.getByLabelText(/^File/), pdf())
    await userEvent.type(dialog.getByLabelText(/^Title/), "Safety handbook")
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "c1")
    await userEvent.type(dialog.getByLabelText(/^Change note/), "Adds the 2026 fire drill")
    await userEvent.click(screen.getByRole("button", { name: "Upload" }))

    expect(await screen.findByText("Detail for a document")).toBeInTheDocument()
    expect(uploads).toHaveLength(1)
    expect(uploads[0].type).toMatch(/^multipart\/form-data; boundary=/)
  })

  it("shows a rejected upload against the form", async () => {
    server.use(
      http.post(`${API}/api/v1/documents/upload`, () =>
        HttpResponse.json({ detail: "File exceeds the 20 MB limit" }, { status: 422 }),
      ),
    )
    renderDocuments()
    await screen.findByRole("link", { name: "Safety handbook" })

    await userEvent.click(screen.getByRole("button", { name: /Upload document/ }))
    const dialog = within(screen.getByRole("dialog"))
    await userEvent.upload(dialog.getByLabelText(/^File/), pdf())
    await userEvent.type(dialog.getByLabelText(/^Title/), "Safety handbook")
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "c1")
    await userEvent.click(screen.getByRole("button", { name: "Upload" }))

    expect(await dialog.findByRole("alert")).toHaveTextContent("File exceeds the 20 MB limit")
    // The dialog stays open so the file can be swapped for a smaller one.
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("reads its filters from the URL on load, and updates the URL when they change", async () => {
    const requests: string[] = []
    server.use(
      http.get(`${API}/api/v1/documents`, ({ request }) => {
        requests.push(request.url)
        return HttpResponse.json(documents)
      }),
    )

    renderDocuments("/admin/documents?category_id=c1&inactive=1")
    await screen.findByRole("link", { name: "Safety handbook" })

    expect(requests[0]).toContain("category_id=c1")
    expect(requests[0]).toContain("include_inactive=true")
    expect(screen.getByRole("button", { name: "Show inactive" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    await userEvent.selectOptions(screen.getByLabelText("Category"), "")
    await expect
      .poll(() => requests.some((url) => !url.includes("category_id")))
      .toBe(true)
  })

  // A blank form fails on Title, which sits above the file input in the
  // dialog — the file's own error stays visible either way, so this is an
  // accepted tradeoff rather than a missed focus target. See the comment at
  // UploadDialog's handleSubmit.
  it("focuses Title, not the file input, on a fully blank submit", async () => {
    renderDocuments()
    await screen.findByRole("link", { name: "Safety handbook" })

    await userEvent.click(screen.getByRole("button", { name: /Upload document/ }))
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.click(screen.getByRole("button", { name: "Upload" }))

    expect(await dialog.findByText("Choose a PDF or DOCX file.")).toBeInTheDocument()
    expect(dialog.getByLabelText(/^Title/)).toHaveFocus()
  })

  it("explains a failed load and recovers when retried", async () => {
    let attempt = 0
    server.use(
      http.get(`${API}/api/v1/documents`, () => {
        attempt += 1
        return attempt === 1
          ? HttpResponse.json({ detail: "Service unavailable." }, { status: 503 })
          : HttpResponse.json(documents)
      }),
    )

    renderDocuments()

    expect(await screen.findByText("Could not load documents")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Service unavailable.")

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(await screen.findByRole("link", { name: "Safety handbook" })).toBeInTheDocument()
    expect(screen.queryByText("Could not load documents")).toBeNull()
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
      <MemoryRouter initialEntries={["/admin/documents"]}>
        <Routes>
          <Route path="/admin/documents" element={<DocumentsPage />} />
          <Route path="/admin/documents/:documentId" element={<p>Detail for a document</p>} />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  )
}

describe("DocumentsPage edit and delete", () => {
  let documents: ReturnType<typeof doc>[]
  let requests: { method: string; url: string; body: unknown }[]
  let deleteStatus: number
  let deleteDetail: string

  function rowFor(title: string) {
    return screen.getByRole("row", { name: new RegExp(title) })
  }

  beforeEach(() => {
    documents = [doc("d1", "Safety handbook"), doc("d2", "Onboarding guide")]
    requests = []
    deleteStatus = 200
    deleteDetail = ""

    server.use(
      http.get(`${API}/api/v1/config/categories`, () =>
        HttpResponse.json([lookup("c1", "Operations"), lookup("c2", "Compliance")]),
      ),
      http.get(`${API}/api/v1/config/skills`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/documents`, () => HttpResponse.json(documents)),
      http.patch(`${API}/api/v1/documents/:id`, async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>
        requests.push({ method: "PATCH", url: request.url, body })
        const target = documents.find((item) => item.document_id === params.id)!
        // The server drops nulls (model_dump(exclude_none = True)), so the stub
        // does too — otherwise the test would assert behaviour the API lacks.
        for (const [key, value] of Object.entries(body)) {
          if (value !== null) (target as Record<string, unknown>)[key] = value
        }
        return HttpResponse.json({ ...target, description: null, versions: [] })
      }),
      http.delete(`${API}/api/v1/documents/:id`, ({ request, params }) => {
        requests.push({ method: "DELETE", url: request.url, body: null })
        if (deleteStatus !== 200) {
          return HttpResponse.json({ detail: deleteDetail }, { status: deleteStatus })
        }
        documents = documents.filter((item) => item.document_id !== params.id)
        return HttpResponse.json({ deleted: 1, versions_deleted: 2, cleanup_warning: null })
      }),
    )
  })

  it("edits a document's title and category through the dialog", async () => {
    renderWithToasts()
    await screen.findByRole("link", { name: "Safety handbook" })

    await clickRowAction(rowFor("Safety handbook"), "Edit")

    const dialog = within(await screen.findByRole("dialog"))
    const title = dialog.getByLabelText(/^Title/)
    await userEvent.clear(title)
    await userEvent.type(title, "Safety handbook 2026")
    await userEvent.selectOptions(dialog.getByLabelText(/^Category/), "c2")
    await userEvent.click(dialog.getByRole("button", { name: "Save changes" }))

    expect(await screen.findByRole("link", { name: "Safety handbook 2026" })).toBeInTheDocument()
    const patch = requests.find((item) => item.method === "PATCH")
    expect(patch?.body).toMatchObject({
      title: "Safety handbook 2026",
      category_id: "c2",
    })
  })

  it("does not delete until the permanent confirmation is accepted", async () => {
    renderWithToasts()
    await screen.findByRole("link", { name: "Safety handbook" })

    await clickRowAction(rowFor("Safety handbook"), "Delete")

    const confirm = within(await screen.findByRole("alertdialog"))
    // Worded as permanent, so it cannot be mistaken for the deactivate confirm.
    expect(confirm.getByText(/cannot be undone/)).toBeInTheDocument()
    expect(requests.some((item) => item.method === "DELETE")).toBe(false)

    await userEvent.click(confirm.getByRole("button", { name: "Cancel" }))
    expect(requests.some((item) => item.method === "DELETE")).toBe(false)
    expect(screen.getByRole("link", { name: "Safety handbook" })).toBeInTheDocument()
  })

  it("removes the document from the list once the delete is confirmed", async () => {
    renderWithToasts()
    await screen.findByRole("link", { name: "Safety handbook" })

    await clickRowAction(rowFor("Safety handbook"), "Delete")
    const confirm = within(await screen.findByRole("alertdialog"))
    await userEvent.click(confirm.getByRole("button", { name: "Delete permanently" }))

    await expect.poll(() => screen.queryByRole("link", { name: "Safety handbook" })).toBeNull()
    expect(requests.some((item) => item.url.endsWith("/documents/d1"))).toBe(true)
    // The one that was not deleted is untouched.
    expect(screen.getByRole("link", { name: "Onboarding guide" })).toBeInTheDocument()
  })

  it("keeps the document and shows the server's reason when a delete is blocked", async () => {
    deleteStatus = 409
    deleteDetail = "Cannot delete a document used by an exam. Delete the exam first."

    renderWithToasts()
    await screen.findByRole("link", { name: "Safety handbook" })

    await clickRowAction(rowFor("Safety handbook"), "Delete")
    const confirm = within(await screen.findByRole("alertdialog"))
    await userEvent.click(confirm.getByRole("button", { name: "Delete permanently" }))

    // Verbatim, because the sentence names which exam blocks it — a generic
    // "could not delete" would leave the admin with nothing to act on.
    expect(await screen.findByText(deleteDetail)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Safety handbook" })).toBeInTheDocument()
  })

  it("passes a daily quiz and chat citation block through just as verbatim", async () => {
    deleteStatus = 409
    deleteDetail = "Cannot delete a document that has been cited in a chat answer."

    renderWithToasts()
    await screen.findByRole("link", { name: "Safety handbook" })

    await clickRowAction(rowFor("Safety handbook"), "Delete")
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Delete permanently",
      }),
    )

    expect(await screen.findByText(deleteDetail)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Safety handbook" })).toBeInTheDocument()
  })
})
