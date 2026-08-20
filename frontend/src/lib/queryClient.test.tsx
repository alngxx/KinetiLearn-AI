import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { api } from "@/lib/apiClient"
import { networkError } from "@/lib/errors"
import { queryClient, shouldRetry } from "@/lib/queryClient"
import { server } from "@/test/server"

const API = "http://localhost:8000"

describe("shouldRetry", () => {
  it("does not retry any 4xx", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetry(0, { status, message: "nope" })).toBe(false)
    }
  })

  it("retries a 5xx twice, then gives up", () => {
    const err = { status: 503, message: "unavailable" }
    expect(shouldRetry(0, err)).toBe(true)
    expect(shouldRetry(1, err)).toBe(true)
    expect(shouldRetry(2, err)).toBe(false)
  })

  it("retries something that is not an ApiError at all", () => {
    expect(shouldRetry(0, new Error("boom"))).toBe(true)
    expect(shouldRetry(2, new Error("boom"))).toBe(false)
  })

  // A request that never reached the server is the case most worth retrying —
  // nothing about it says the request itself was wrong. It carries status 0,
  // so the policy has to name it explicitly alongside the 5xx range.
  it("retries a network failure twice, then gives up", () => {
    const err = networkError()
    expect(err.status).toBe(0)
    expect(shouldRetry(0, err)).toBe(true)
    expect(shouldRetry(1, err)).toBe(true)
    expect(shouldRetry(2, err)).toBe(false)
  })
})

describe("the shared QueryClient", () => {
  it("applies shouldRetry as the default query retry policy", () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetry)
  })
})

// Drives the policy through real react-query machinery and counts how many
// times the request actually leaves. retryDelay is flattened so the 5xx case
// does not sit through exponential backoff.
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry, retryDelay: 0 } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function useProbe() {
  return useQuery({
    queryKey: ["probe"],
    queryFn: () => api.get("/api/v1/config/categories", { skipAuthRedirect: true }),
  })
}

describe("retry behaviour end to end", () => {
  it("surfaces a 404 immediately, after exactly one request", async () => {
    let attempts = 0
    server.use(
      http.get(`${API}/api/v1/config/categories`, () => {
        attempts += 1
        return HttpResponse.json({ detail: "Category not found." }, { status: 404 })
      }),
    )

    const { result } = renderHook(useProbe, { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(attempts).toBe(1)
    expect(result.current.error).toMatchObject({ status: 404, message: "Category not found." })
  })

  it("surfaces a 422 immediately, after exactly one request", async () => {
    let attempts = 0
    server.use(
      http.get(`${API}/api/v1/config/categories`, () => {
        attempts += 1
        return HttpResponse.json({ detail: "Unprocessable." }, { status: 422 })
      }),
    )

    const { result } = renderHook(useProbe, { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(attempts).toBe(1)
  })

  it("retries a 503 twice before failing — three requests in total", async () => {
    let attempts = 0
    server.use(
      http.get(`${API}/api/v1/config/categories`, () => {
        attempts += 1
        return HttpResponse.json({ detail: "Service unavailable." }, { status: 503 })
      }),
    )

    const { result } = renderHook(useProbe, { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(attempts).toBe(3)
  })

  it("recovers when a retried 503 succeeds on the second attempt", async () => {
    let attempts = 0
    server.use(
      http.get(`${API}/api/v1/config/categories`, () => {
        attempts += 1
        return attempts === 1
          ? HttpResponse.json({ detail: "Service unavailable." }, { status: 503 })
          : HttpResponse.json([{ id: "c1", name: "Backend" }])
      }),
    )

    const { result } = renderHook(useProbe, { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(attempts).toBe(2)
    expect(result.current.data).toEqual([{ id: "c1", name: "Backend" }])
  })
})
