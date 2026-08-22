import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
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

function renderDocuments() {
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
