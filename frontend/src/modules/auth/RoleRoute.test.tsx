import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { setToken } from "@/lib/tokenStorage"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { ProtectedRoute } from "@/modules/auth/ProtectedRoute"
import { RoleRoute } from "@/modules/auth/RoleRoute"
import { homePathForRole } from "@/modules/auth/roles"

function tokenFor(role: string): string {
  const b64 = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    sub: "3f1b0c9e-0000-4000-8000-000000000001",
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`
}

function LoginProbe() {
  const location = useLocation()
  return (
    <div>
      login page<span data-testid="login-search">{location.search}</span>
    </div>
  )
}

// Mirrors the tree in App.tsx, with the layouts replaced by markers.
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<RoleRoute role="admin" />}>
              <Route path="/admin" element={<div>admin area</div>} />
            </Route>
            <Route element={<RoleRoute role="learner" />}>
              <Route path="/learner" element={<div>learner area</div>} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe("homePathForRole", () => {
  it.each([
    { role: "admin", expected: "/admin" },
    { role: "learner", expected: "/learner" },
    // Any unrecognised role gets the least-privileged home.
    { role: "something-else", expected: "/learner" },
  ])("sends $role to $expected", ({ role, expected }) => {
    expect(homePathForRole(role)).toBe(expected)
  })
})

describe("ProtectedRoute", () => {
  it("sends a signed-out visitor to the login page", () => {
    renderAt("/admin")
    expect(screen.getByText("login page")).toBeInTheDocument()
  })

  it("keeps the attempted path in ?next= so login can return there", () => {
    renderAt("/admin")
    expect(screen.getByTestId("login-search")).toHaveTextContent("?next=%2Fadmin")
  })
})

describe("RoleRoute", () => {
  it("lets an admin into the admin area", () => {
    setToken(tokenFor("admin"))
    renderAt("/admin")
    expect(screen.getByText("admin area")).toBeInTheDocument()
  })

  it("lets a learner into the learner area", () => {
    setToken(tokenFor("learner"))
    renderAt("/learner")
    expect(screen.getByText("learner area")).toBeInTheDocument()
  })

  it("redirects a learner away from the admin area to their own home", () => {
    setToken(tokenFor("learner"))
    renderAt("/admin")
    expect(screen.getByText("learner area")).toBeInTheDocument()
    expect(screen.queryByText("admin area")).not.toBeInTheDocument()
  })

  it("redirects an admin away from the learner area to their own home", () => {
    setToken(tokenFor("admin"))
    renderAt("/learner")
    expect(screen.getByText("admin area")).toBeInTheDocument()
  })
})
