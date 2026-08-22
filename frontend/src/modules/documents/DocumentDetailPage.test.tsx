import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Toaster } from "@/components/ui/sonner"
import { DocumentDetailPage } from "@/modules/documents/DocumentDetailPage"
import { POLL_INTERVAL_MS } from "@/modules/documents/queries"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function version(number: number, status: string, extra: Record<string, unknown> = {}) {
  return {
    version_number: number,
    file_name: `handbook-v${number}.pdf`,
    file_size_bytes: 2_100_000,
    mime_type: "application/pdf",
    processing_status: status,
    processing_error: null,
    change_note: null,
    created_at: "2026-01-01T00:00:00Z",
    ...extra,
  }
}

function lookup(id: string, name: string) {
  return { id, name, description: null, is_active: true, created_at: "2026-01-01T00:00:00Z" }
}

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/documents/d1"]}>
        <Routes>
          <Route path="/admin/documents/:documentId" element={<DocumentDetailPage />} />
        </Routes>
        <Toaster />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("DocumentDetailPage", () => {
  let detail: {
    document_id: string
    title: string
    description: string | null
    category_id: string
    active_version_number: number | null
    is_active: boolean
    skill_ids: string[]
    versions: ReturnType<typeof version>[]
    created_at: string
  }
  let detailRequests: number
  let calls: { method: string; url: string }[]

  beforeEach(() => {
    detail = {
      document_id: "d1",
      title: "Safety handbook",
      description: "How the fire drill runs.",
      category_id: "c1",
      active_version_number: 1,
      is_active: true,
      skill_ids: ["s1"],
      versions: [version(2, "ready"), version(1, "ready")],
      created_at: "2026-01-01T00:00:00Z",
    }
    detailRequests = 0
    calls = []

    server.use(
      http.get(`${API}/api/v1/config/categories`, () =>
        HttpResponse.json([lookup("c1", "Operations")]),
      ),
      http.get(`${API}/api/v1/config/skills`, () =>
        HttpResponse.json([lookup("s1", "Fire safety"), lookup("s2", "Evacuation")]),
      ),
      http.get(`${API}/api/v1/documents/d1`, () => {
        detailRequests += 1
        return HttpResponse.json(detail)
      }),
      http.patch(`${API}/api/v1/documents/d1/versions/:n/promote`, ({ request, params }) => {
        calls.push({ method: "PATCH", url: request.url })
        detail.active_version_number = Number(params.n)
        return HttpResponse.json({ document_id: "d1", title: detail.title })
      }),
      http.post(`${API}/api/v1/documents/d1/versions/:n/reprocess`, ({ request, params }) => {
        calls.push({ method: "POST", url: request.url })
        const target = detail.versions.find((v) => v.version_number === Number(params.n))!
        target.processing_status = "pending"
        target.processing_error = null
        return HttpResponse.json({ document_id: "d1", version_number: Number(params.n) })
      }),
      http.post(`${API}/api/v1/documents/d1/skills/:skillId`, ({ request, params }) => {
        calls.push({ method: "POST", url: request.url })
        detail.skill_ids = [...detail.skill_ids, String(params.skillId)]
        return HttpResponse.json({ document_id: "d1", skill_ids: detail.skill_ids })
      }),
      http.delete(`${API}/api/v1/documents/d1/skills/:skillId`, ({ request, params }) => {
        calls.push({ method: "DELETE", url: request.url })
        detail.skill_ids = detail.skill_ids.filter((id) => id !== String(params.skillId))
        return HttpResponse.json({ document_id: "d1", skill_ids: detail.skill_ids })
      }),
    )
  })

  it("marks the promoted version as live", async () => {
    renderDetail()

    expect(await screen.findByText("Safety handbook")).toBeInTheDocument()
    expect(within(screen.getByRole("row", { name: /v1/ })).getByText("Live")).toBeInTheDocument()
    expect(within(screen.getByRole("row", { name: /v2/ })).queryByText("Live")).toBeNull()
  })

  it("promotes a version", async () => {
    renderDetail()
    await screen.findByText("Safety handbook")

    await userEvent.click(
      within(screen.getByRole("row", { name: /v2/ })).getByRole("button", { name: "Promote" }),
    )

    expect(
      await within(screen.getByRole("row", { name: /v2/ })).findByText("Live"),
    ).toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith("/versions/2/promote"))).toBe(true)
  })

  it("offers no promote for a version that is not ready", async () => {
    detail.versions = [version(2, "failed"), version(1, "ready")]
    renderDetail()
    await screen.findByText("Safety handbook")

    const failed = within(screen.getByRole("row", { name: /v2/ }))
    expect(failed.queryByRole("button", { name: "Promote" })).toBeNull()
  })

  it("surfaces a refused promote", async () => {
    server.use(
      http.patch(`${API}/api/v1/documents/d1/versions/:n/promote`, () =>
        HttpResponse.json({ detail: "Version is not ready to be activated" }, { status: 409 }),
      ),
    )
    renderDetail()
    await screen.findByText("Safety handbook")

    await userEvent.click(
      within(screen.getByRole("row", { name: /v2/ })).getByRole("button", { name: "Promote" }),
    )

    expect(await screen.findByText("Version is not ready to be activated")).toBeInTheDocument()
    // The promotion did not happen, so v1 is still the live one.
    expect(within(screen.getByRole("row", { name: /v1/ })).getByText("Live")).toBeInTheDocument()
  })

  // Reprocessing a failed version has nothing to lose — no chunks, no vectors,
  // nothing live — so it must not put a confirmation in the way.
  it("reprocesses a failed version immediately, with no confirmation", async () => {
    detail.versions = [version(2, "failed", { processing_error: "No text could be extracted" })]
    detail.active_version_number = null
    renderDetail()
    await screen.findByText("Safety handbook")

    await userEvent.click(screen.getByRole("button", { name: "Reprocess" }))

    expect(screen.queryByRole("alertdialog")).toBeNull()
    await expect
      .poll(() => calls.some((c) => c.url.endsWith("/versions/2/reprocess")))
      .toBe(true)
  })

  // Reprocessing a ready version deletes its chunks and vectors first, so it
  // must ask, and must send nothing until the admin confirms.
  it("asks before reprocessing a ready version, and only then sends it", async () => {
    renderDetail()
    await screen.findByText("Safety handbook")

    await userEvent.click(
      within(screen.getByRole("row", { name: /v2/ })).getByRole("button", { name: "Reprocess" }),
    )

    const confirm = within(await screen.findByRole("alertdialog"))
    expect(calls.some((c) => c.url.includes("/reprocess"))).toBe(false)

    await userEvent.click(confirm.getByRole("button", { name: "Reprocess" }))

    await expect
      .poll(() => calls.some((c) => c.url.endsWith("/versions/2/reprocess")))
      .toBe(true)
  })

  it("sends nothing when the reprocess confirmation is cancelled", async () => {
    renderDetail()
    await screen.findByText("Safety handbook")

    await userEvent.click(
      within(screen.getByRole("row", { name: /v2/ })).getByRole("button", { name: "Reprocess" }),
    )
    const confirm = within(await screen.findByRole("alertdialog"))
    await userEvent.click(confirm.getByRole("button", { name: "Cancel" }))

    expect(calls.some((c) => c.url.includes("/reprocess"))).toBe(false)
  })

  it("offers only skills the document does not already have, and attaches one", async () => {
    renderDetail()
    await screen.findByText("Safety handbook")

    const picker = screen.getByLabelText("Add skill")
    expect(within(picker).getByRole("option", { name: "Evacuation" })).toBeInTheDocument()
    // Already attached, so offering it would be an option that does nothing.
    expect(within(picker).queryByRole("option", { name: "Fire safety" })).toBeNull()

    await userEvent.selectOptions(picker, "s2")

    expect(await screen.findByRole("button", { name: "Remove Evacuation" })).toBeInTheDocument()
    expect(calls.some((c) => c.url.endsWith("/skills/s2"))).toBe(true)
    // Now that it is attached it drops out of the picker.
    expect(
      within(screen.getByLabelText("Add skill")).queryByRole("option", { name: "Evacuation" }),
    ).toBeNull()
  })

  it("detaches a skill", async () => {
    renderDetail()
    await screen.findByText("Safety handbook")

    await userEvent.click(await screen.findByRole("button", { name: "Remove Fire safety" }))

    expect(await screen.findByText(/Untagged/)).toBeInTheDocument()
    expect(
      calls.some((c) => c.method === "DELETE" && c.url.endsWith("/skills/s1")),
    ).toBe(true)
  })

  describe("polling", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("follows a version to ready and then stops polling", async () => {
      detail.versions = [version(1, "processing")]
      renderDetail()

      expect(await screen.findByRole("status")).toHaveTextContent("Processing")

      detail.versions = [version(1, "ready")]
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      await expect.poll(() => screen.getByRole("status").textContent).toBe("Ready")

      // Settled, so the interval must be gone rather than merely slower.
      const settledAt = detailRequests
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
      expect(detailRequests).toBe(settledAt)
    })

    it("follows a version to failed and then stops polling", async () => {
      detail.versions = [version(1, "processing")]
      renderDetail()

      expect(await screen.findByRole("status")).toHaveTextContent("Processing")

      detail.versions = [version(1, "failed", { processing_error: "No text could be extracted" })]
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)

      await expect.poll(() => screen.getByRole("status").textContent).toBe("Failed")
      expect(screen.getByText("No text could be extracted")).toBeInTheDocument()

      const settledAt = detailRequests
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5)
      expect(detailRequests).toBe(settledAt)
    })
  })
})
