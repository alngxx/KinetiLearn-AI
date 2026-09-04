import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminPortal } from "@/AdminPortal"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { ThemeProvider } from "@/modules/theme/ThemeContext"
import { server } from "@/test/server"

const API = "http://localhost:8000"

// App.tsx mounts AdminPortal under a splat, so its child paths are relative.
// These assert the relative table still resolves the same URLs the sidebar and
// every existing Link in the console point at.
function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          {/* Same splat App.tsx mounts it under — without it the relative
              child paths have nothing to be relative to. */}
          <Routes>
            <Route path="/admin/*" element={<AdminPortal />} />
          </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

describe("AdminPortal routing", () => {
  beforeEach(() => {
    // AdminLayout renders ThemeToggle, which reads the OS preference on mount.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    // The route table is what is under test, not the data. Every screen renders
    // its header before its query settles, so empty payloads are enough.
    server.use(
      http.get(`${API}/api/v1/*`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/auth/me`, () =>
        HttpResponse.json({ id: "u1", email: "a@b.c", full_name: "Admin", role: "admin" }),
      ),
    )
  })

  it("sends the bare /admin path to Users", async () => {
    renderAt("/admin")
    expect(await screen.findByRole("heading", { name: "Users", level: 1 })).toBeInTheDocument()
  })

  it.each([
    ["/admin/users", "Users"],
    ["/admin/classes", "Classes"],
    ["/admin/documents", "Documents"],
    ["/admin/daily-quizzes", "Daily Quiz"],
    ["/admin/submissions", "Submission"],
    ["/admin/config/categories", "Categories"],
    ["/admin/config/employee-levels", "Employee levels"],
  ])("resolves %s", async (path, heading) => {
    renderAt(path)
    expect(await screen.findByRole("heading", { name: heading, level: 1 })).toBeInTheDocument()
  })

  it("keeps the console shell around every screen", async () => {
    renderAt("/admin/users")
    // The sidebar comes from AdminLayout, which is a pathless layout route here
    // — if that nesting broke, the page would render without its nav.
    expect(await screen.findByRole("link", { name: /Submission/ })).toBeInTheDocument()
  })
})
