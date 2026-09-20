import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { userEvent } from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AdminLayout } from "@/layouts/AdminLayout"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { ThemeProvider } from "@/modules/theme/ThemeContext"
import { server } from "@/test/server"

const API = "http://localhost:8000"
const STORAGE_KEY = "kinetilearn_admin_sidebar_width"

function renderLayout() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={["/admin/users"]}>
            <Routes>
              <Route path="/admin" element={<AdminLayout />}>
                <Route path="users" element={<p>Users screen</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

function getHandle() {
  return screen.getByRole("separator", { name: "Resize sidebar" })
}

describe("AdminLayout sidebar resize", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-color-scheme: dark)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    server.use(
      http.get(`${API}/api/v1/*`, () => HttpResponse.json([])),
      http.get(`${API}/api/v1/users/me`, () =>
        HttpResponse.json({
          id: "u1",
          email: "a@b.c",
          full_name: "Admin User",
          role: "admin",
          is_active: true,
          department_id: null,
          seniority_id: null,
          job_position_id: null,
          employee_level_id: null,
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
        }),
      ),
    )
    localStorage.clear()
  })

  it("defaults to 240px and exposes the separator's range", async () => {
    renderLayout()
    const handle = getHandle()
    expect(handle).toHaveAttribute("aria-valuenow", "240")
    expect(handle).toHaveAttribute("aria-valuemin", "200")
    expect(handle).toHaveAttribute("aria-valuemax", "400")
  })

  it("restores a previously stored width, clamped to the allowed range", async () => {
    localStorage.setItem(STORAGE_KEY, "9999")
    renderLayout()
    expect(getHandle()).toHaveAttribute("aria-valuenow", "400")
  })

  it("resizes with the arrow keys and persists the new width", async () => {
    const user = userEvent.setup()
    renderLayout()
    const handle = getHandle()
    handle.focus()

    await user.keyboard("{ArrowRight}")
    expect(handle).toHaveAttribute("aria-valuenow", "256")
    expect(localStorage.getItem(STORAGE_KEY)).toBe("256")

    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(handle).toHaveAttribute("aria-valuenow", "224")
  })

  it("clamps to the min/max bounds with Home and End", async () => {
    const user = userEvent.setup()
    renderLayout()
    const handle = getHandle()
    handle.focus()

    await user.keyboard("{End}")
    expect(handle).toHaveAttribute("aria-valuenow", "400")

    await user.keyboard("{Home}")
    expect(handle).toHaveAttribute("aria-valuenow", "200")
  })

  it("still renders at the default width when localStorage is blocked", async () => {
    // Only the sidebar's own key is blocked — ThemeProvider reads its own key
    // on mount too, and that read isn't guarded, so a blanket block would fail
    // for a reason unrelated to what this test is checking.
    const originalGetItem = Storage.prototype.getItem
    Storage.prototype.getItem = function (this: Storage, key: string) {
      if (key === STORAGE_KEY) throw new DOMException("blocked", "SecurityError")
      return originalGetItem.call(this, key)
    }

    try {
      renderLayout()
      expect(await screen.findByText("Users screen")).toBeInTheDocument()
      expect(getHandle()).toHaveAttribute("aria-valuenow", "240")
    } finally {
      Storage.prototype.getItem = originalGetItem
    }
  })
})
