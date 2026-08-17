import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { http, HttpResponse } from "msw"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { getToken } from "@/lib/tokenStorage"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { LoginPage } from "@/modules/auth/LoginPage"
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

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin" element={<div>admin area</div>} />
          <Route path="/learner" element={<div>learner area</div>} />
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
})
