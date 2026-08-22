import { http, HttpResponse } from "msw"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { api, buildLoginRedirect } from "@/lib/apiClient"
import { queryClient } from "@/lib/queryClient"
import { getToken, setToken } from "@/lib/tokenStorage"
import { server } from "@/test/server"

const API = "http://localhost:8000"
const TOKEN = "header.payload.signature"

function stubLocation(pathname: string, search = "") {
  const assign = vi.fn()
  vi.stubGlobal("location", { pathname, search, assign })
  return assign
}

beforeEach(() => {
  queryClient.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("buildLoginRedirect", () => {
  const cases = [
    { name: "plain path", pathname: "/admin", search: "", expected: "/login?next=%2Fadmin" },
    {
      name: "path with query string",
      pathname: "/admin/users",
      search: "?page=2",
      expected: "/login?next=%2Fadmin%2Fusers%3Fpage%3D2",
    },
    { name: "learner path", pathname: "/learner", search: "", expected: "/login?next=%2Flearner" },
    // Without this the 401 handler would bounce /login to /login forever.
    { name: "already on login", pathname: "/login", search: "", expected: null },
    { name: "already on login with next", pathname: "/login", search: "?next=%2Fadmin", expected: null },
  ]

  it.each(cases)("$name", ({ pathname, search, expected }) => {
    expect(buildLoginRedirect(pathname, search)).toBe(expected)
  })
})

describe("401 handling", () => {
  it("clears the token, resets the query cache and redirects with next", async () => {
    const assign = stubLocation("/admin", "")
    setToken(TOKEN)
    queryClient.setQueryData(["users"], [{ id: "u1" }])

    server.use(
      http.get(`${API}/api/v1/users/me`, () =>
        HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 }),
      ),
    )

    await expect(api.get("/api/v1/users/me")).rejects.toEqual({
      status: 401,
      message: "Could not validate credentials",
    })

    expect(getToken()).toBeNull()
    expect(queryClient.getQueryData(["users"])).toBeUndefined()
    expect(assign).toHaveBeenCalledWith("/login?next=%2Fadmin")
  })

  it("does not redirect when the 401 arrives while already on /login", async () => {
    const assign = stubLocation("/login", "")
    setToken(TOKEN)

    server.use(
      http.get(`${API}/api/v1/users/me`, () =>
        HttpResponse.json({ detail: "Could not validate credentials" }, { status: 401 }),
      ),
    )

    await expect(api.get("/api/v1/users/me")).rejects.toMatchObject({ status: 401 })

    expect(getToken()).toBeNull()
    expect(assign).not.toHaveBeenCalled()
  })

  it("leaves the session alone when skipAuthRedirect is set (bad login credentials)", async () => {
    const assign = stubLocation("/login", "")
    setToken(TOKEN)

    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ detail: "Invalid credentials" }, { status: 401 }),
      ),
    )

    await expect(
      api.post("/api/v1/auth/login", { email: "a@b.c", password: "wrong" }, { skipAuthRedirect: true }),
    ).rejects.toEqual({ status: 401, message: "Invalid credentials" })

    expect(getToken()).toBe(TOKEN)
    expect(assign).not.toHaveBeenCalled()
  })
})

describe("requests", () => {
  it("attaches the bearer token", async () => {
    stubLocation("/admin")
    setToken(TOKEN)
    let seenAuth: string | null = null

    server.use(
      http.get(`${API}/api/v1/users/me`, ({ request }) => {
        seenAuth = request.headers.get("Authorization")
        return HttpResponse.json({ id: "u1", role: "admin" })
      }),
    )

    await expect(api.get("/api/v1/users/me")).resolves.toEqual({ id: "u1", role: "admin" })
    expect(seenAuth).toBe(`Bearer ${TOKEN}`)
  })

  it("sends no Authorization header when signed out", async () => {
    stubLocation("/login")
    let seenAuth: string | null = "unset"

    server.use(
      http.post(`${API}/api/v1/auth/login`, ({ request }) => {
        seenAuth = request.headers.get("Authorization")
        return HttpResponse.json({ access_token: "t", token_type: "bearer" })
      }),
    )

    await api.post("/api/v1/auth/login", { email: "a@b.c", password: "pw" })
    expect(seenAuth).toBeNull()
  })

  // A FormData body must reach the server as multipart with the browser's own
  // boundary. Stringifying it, or forcing a JSON content type, would send "{}"
  // and every upload field would arrive missing.
  it("sends FormData as multipart and leaves the content type to the browser", async () => {
    stubLocation("/admin")
    setToken(TOKEN)
    let seenType: string | null = null
    let seenBody = ""

    server.use(
      http.post(`${API}/api/v1/documents/upload`, async ({ request }) => {
        seenType = request.headers.get("Content-Type")
        seenBody = await request.text()
        return HttpResponse.json({ document_id: "d1", version_number: 1 }, { status: 201 })
      }),
    )

    // Text-only on purpose: jsdom's File cannot be streamed back out by msw, so
    // reading a body that contains one hangs. Whether the parts are text or a
    // file makes no difference to what this asserts.
    const form = new FormData()
    form.set("title", "Safety handbook")

    await api.post("/api/v1/documents/upload", form)

    expect(seenType).toMatch(/^multipart\/form-data; boundary=/)
    expect(seenBody).toContain("Safety handbook")
  })

  it("normalizes a 422 into field errors", async () => {
    stubLocation("/login")

    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json(
          {
            detail: [
              {
                loc: ["body", "email"],
                msg: "value is not a valid email address",
                type: "value_error",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    )

    await expect(
      api.post("/api/v1/auth/login", { email: "nope", password: "pw" }),
    ).rejects.toMatchObject({
      status: 422,
      fields: { email: "value is not a valid email address" },
    })
  })
})
