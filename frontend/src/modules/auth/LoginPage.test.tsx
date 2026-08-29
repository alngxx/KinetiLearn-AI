import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { getToken } from "@/lib/tokenStorage"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { LoginPage } from "@/modules/auth/LoginPage"
import { ProtectedRoute } from "@/modules/auth/ProtectedRoute"
import { RoleRoute } from "@/modules/auth/RoleRoute"
import { server } from "@/test/server"

const API = "http://localhost:8000"

function tokenFor(role: string): string {
  const b64 = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    sub: "3f1b0c9e-0000-4000-8000-000000000001",
    role,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`
}

function renderLogin(entry = "/login") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<div>home redirect</div>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<div>admin area</div>} />
          <Route path="/admin/users" element={<div>users area</div>} />
          <Route path="/learner" element={<div>learner area</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

// The gated tree from App.tsx, so what happens after login is decided by the same
// ProtectedRoute/RoleRoute pair the real app uses rather than by a bare route.
function renderGatedLogin(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
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

async function submitCredentials(email: string, password: string) {
  await userEvent.type(screen.getByLabelText("Email"), email)
  await userEvent.type(screen.getByLabelText("Password"), password)
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }))
}

describe("LoginPage", () => {
  it("stores the token and lands on the area for the returned role", async () => {
    const token = tokenFor("admin")
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: token, token_type: "bearer" }),
      ),
    )

    renderLogin()
    await submitCredentials("admin@kinetilearn.com", "admin1234")

    expect(await screen.findByText("admin area")).toBeInTheDocument()
    expect(getToken()).toBe(token)
  })

  it("shows the error and stays put when the credentials are rejected", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 }),
      ),
    )

    renderLogin()
    await submitCredentials("admin@kinetilearn.com", "wrong")

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials")
    expect(getToken()).toBeNull()
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
  })

  // ProtectedRoute and the 401 handler both park the attempted path in ?next=.
  // Both were only ever tested for writing it; this is the read back.
  it("returns to ?next= instead of the role home", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: tokenFor("admin"), token_type: "bearer" }),
      ),
    )

    renderLogin("/login?next=%2Fadmin%2Fusers")
    await submitCredentials("admin@kinetilearn.com", "admin1234")

    expect(await screen.findByText("users area")).toBeInTheDocument()
  })

  it("falls back to the root when the returned token cannot be decoded", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: "not-a-jwt", token_type: "bearer" }),
      ),
    )

    renderLogin()
    await submitCredentials("admin@kinetilearn.com", "admin1234")

    expect(await screen.findByText("home redirect")).toBeInTheDocument()
  })

  // ?next= is attacker-supplied in the sense that it survives in a shared or
  // bookmarked URL. Following it must not put a learner anywhere their role
  // cannot go — the role gate, not the login form, is what settles that.
  it("cannot land a learner in the admin area through a stale ?next=", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: tokenFor("learner"), token_type: "bearer" }),
      ),
    )

    renderGatedLogin("/login?next=%2Fadmin")
    await submitCredentials("alice@kinetilearn.com", "learner1234")

    expect(await screen.findByText("learner area")).toBeInTheDocument()
    expect(screen.queryByText("admin area")).not.toBeInTheDocument()
  })
})
