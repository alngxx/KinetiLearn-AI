import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { queryClient } from "@/lib/queryClient"
import { getToken, setToken } from "@/lib/tokenStorage"
import { AuthProvider, readStoredToken, userFromToken } from "@/modules/auth/AuthContext"
import { useAuth } from "@/modules/auth/useAuth"

const HOUR = 3600

function tokenExpiringAt(expSeconds: number, role = "admin"): string {
  const b64 = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    sub: "3f1b0c9e-0000-4000-8000-000000000001",
    role,
    exp: expSeconds,
  })}.signature`
}

function futureToken(role = "admin"): string {
  return tokenExpiringAt(Math.floor(Date.now() / 1000) + HOUR, role)
}

function expiredToken(role = "admin"): string {
  return tokenExpiringAt(Math.floor(Date.now() / 1000) - HOUR, role)
}

beforeEach(() => {
  queryClient.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("readStoredToken", () => {
  it("returns nothing when no token was stored", () => {
    expect(readStoredToken()).toBeNull()
  })

  it("keeps a token that has not expired", () => {
    const token = futureToken()
    setToken(token)
    expect(readStoredToken()).toBe(token)
    expect(getToken()).toBe(token)
  })

  it("discards an already-expired token and wipes it from storage", () => {
    setToken(expiredToken())
    expect(readStoredToken()).toBeNull()
    expect(getToken()).toBeNull()
  })

  it("discards a token it cannot decode", () => {
    setToken("this.is.not-a-jwt")
    expect(readStoredToken()).toBeNull()
    expect(getToken()).toBeNull()
  })
})

describe("userFromToken", () => {
  it("maps the sub and role claims onto the user", () => {
    expect(userFromToken(futureToken("learner"))).toEqual({
      id: "3f1b0c9e-0000-4000-8000-000000000001",
      role: "learner",
    })
  })

  it("is null when signed out", () => {
    expect(userFromToken(null)).toBeNull()
  })
})

function AuthProbe() {
  const { user, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="role">{user === null ? "signed-out" : user.role}</span>
      <button onClick={() => login(futureToken("learner"))}>sign in</button>
      <button onClick={logout}>sign out</button>
    </div>
  )
}

describe("AuthProvider", () => {
  it("hydrates from localStorage on boot", () => {
    setToken(futureToken("admin"))
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )
    expect(screen.getByTestId("role")).toHaveTextContent("admin")
  })

  it("boots signed out when the stored token has expired", () => {
    setToken(expiredToken())
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )
    expect(screen.getByTestId("role")).toHaveTextContent("signed-out")
  })

  it("stores the token on login", async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await userEvent.click(screen.getByRole("button", { name: "sign in" }))

    expect(screen.getByTestId("role")).toHaveTextContent("learner")
    expect(getToken()).not.toBeNull()
  })

  it("clears the token and the query cache on logout", async () => {
    setToken(futureToken("admin"))
    queryClient.setQueryData(["users"], [{ id: "u1" }])

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    )

    await userEvent.click(screen.getByRole("button", { name: "sign out" }))

    expect(screen.getByTestId("role")).toHaveTextContent("signed-out")
    expect(getToken()).toBeNull()
    expect(queryClient.getQueryData(["users"])).toBeUndefined()
  })
})
