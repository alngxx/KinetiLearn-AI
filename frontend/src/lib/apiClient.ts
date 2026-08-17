import { networkError, normalizeError, type ApiError } from "@/lib/errors"
import { queryClient } from "@/lib/queryClient"
import { clearToken, getToken } from "@/lib/tokenStorage"

// This module is the only place that reads import.meta.env. Missing config fails
// at boot rather than at the first request.
const baseUrl = import.meta.env.VITE_API_BASE_URL
if (!baseUrl) {
  throw new Error(
    "VITE_API_BASE_URL is not set. Copy .env.example to .env.development and restart the dev server.",
  )
}

export const API_BASE_URL: string = baseUrl

export type RequestOptions = {
  // A 401 from the login form means "wrong password", not "session expired",
  // so it must not clear state and bounce the user off the page they are on.
  skipAuthRedirect?: boolean
  signal?: AbortSignal
}

// Returns null when already on the login page, so a 401 there cannot start a
// redirect loop.
export function buildLoginRedirect(pathname: string, search: string): string | null {
  if (pathname === "/login") return null
  const next = `${pathname}${search}`
  return `/login?next=${encodeURIComponent(next)}`
}

// The single 401 handler for the whole app.
export function handleUnauthorized(): void {
  clearToken()
  queryClient.clear()
  const target = buildLoginRedirect(window.location.pathname, window.location.search)
  if (target !== null) window.location.assign(target)
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token === null ? {} : { Authorization: `Bearer ${token}` }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...authHeaders(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw networkError()
  }

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRedirect) handleUnauthorized()
    const error: ApiError = normalizeError(response.status, await readBody(response))
    throw error
  }

  if (response.status === 204) return undefined as T
  return (await readBody(response)) as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiRequest<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>("PUT", path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>("PATCH", path, body, options),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>("DELETE", path, body, options),
}
