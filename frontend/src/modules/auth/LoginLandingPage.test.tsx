import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { getToken } from "@/lib/tokenStorage"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { LoginLandingPage } from "@/modules/auth/LoginLandingPage"
import { ProtectedRoute } from "@/modules/auth/ProtectedRoute"
import { RoleRoute } from "@/modules/auth/RoleRoute"
import { ThemeProvider } from "@/modules/theme/ThemeContext"
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
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<div>home redirect</div>} />
            <Route path="/login" element={<LoginLandingPage />} />
            <Route path="/admin" element={<div>admin area</div>} />
            <Route path="/admin/users" element={<div>users area</div>} />
            <Route path="/learner" element={<div>learner area</div>} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

// The gated tree from App.tsx, so what happens after login is decided by the same
// ProtectedRoute/RoleRoute pair the real app uses rather than by a bare route.
function renderGatedLogin(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginLandingPage />} />
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
      </ThemeProvider>
    </MemoryRouter>,
  )
}

// The landing opens on the two doors; the form is one click behind either of
// them. Which one is picked never reaches the request, so the tests below pick
// the manager door unless they are specifically about the other.
async function openDoor(name: "Log in as admins" | "Log in as learners") {
  await userEvent.click(screen.getByRole("button", { name }))
}

async function submitCredentials(email: string, password: string) {
  await userEvent.type(screen.getByLabelText("Email"), email)
  await userEvent.type(screen.getByLabelText("Password"), password)
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }))
}

describe("LoginLandingPage", () => {
  it("opens both doors onto the same form", async () => {
    renderLogin()
    expect(screen.getByRole("heading", { name: "Managers" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Employees" })).toBeInTheDocument()

    await openDoor("Log in as learners")

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument()
    expect(screen.getByText("Sign in to continue your assigned training.")).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toBeInTheDocument()
  })

  it("goes back to the doors without leaving the page", async () => {
    renderLogin()
    await openDoor("Log in as admins")
    await userEvent.click(screen.getByRole("button", { name: "Back" }))

    expect(screen.getByRole("heading", { name: "Managers" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument()
  })

  it("stores the token and lands on the area for the returned role", async () => {
    const token = tokenFor("admin")
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: token, token_type: "bearer" }),
      ),
    )

    renderLogin()
    await openDoor("Log in as admins")
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
    await openDoor("Log in as admins")
    await submitCredentials("admin@kinetilearn.com", "wrong")

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials")
    expect(getToken()).toBeNull()
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
  })

  // ProtectedRoute and the 401 handler both park the attempted path in ?next=.
  // Picking a door rewrites the query string, so it has to survive that too.
  it("returns to ?next= instead of the role home", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: tokenFor("admin"), token_type: "bearer" }),
      ),
    )

    renderLogin("/login?next=%2Fadmin%2Fusers")
    await openDoor("Log in as admins")
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
    await openDoor("Log in as admins")
    await submitCredentials("admin@kinetilearn.com", "admin1234")

    expect(await screen.findByText("home redirect")).toBeInTheDocument()
  })

  // ?next= is attacker-supplied in the sense that it survives in a shared or
  // bookmarked URL. Following it must not put a learner anywhere their role
  // cannot go - the role gate, not the login form, is what settles that.
  it("cannot land a learner in the admin area through a stale ?next=", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: tokenFor("learner"), token_type: "bearer" }),
      ),
    )

    renderGatedLogin("/login?next=%2Fadmin")
    await openDoor("Log in as learners")
    await submitCredentials("alice@kinetilearn.com", "learner1234")

    expect(await screen.findByText("learner area")).toBeInTheDocument()
    expect(screen.queryByText("admin area")).not.toBeInTheDocument()
  })

  // The door is copy only. Deep-linking a learner to the manager door changes
  // the welcome sentence and nothing else: the backend's role claim still
  // decides where they end up.
  it("does not let ?door=admin put a learner in the admin area", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: tokenFor("learner"), token_type: "bearer" }),
      ),
    )

    renderGatedLogin("/login?door=admin")
    expect(screen.getByText("Sign in to continue your management.")).toBeInTheDocument()

    await submitCredentials("alice@kinetilearn.com", "learner1234")

    expect(await screen.findByText("learner area")).toBeInTheDocument()
  })

  it("ignores a door value it does not recognise", () => {
    renderLogin("/login?door=superuser")
    expect(screen.getByRole("heading", { name: "Managers" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument()
  })
})
