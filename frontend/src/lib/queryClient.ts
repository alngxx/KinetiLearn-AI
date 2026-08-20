import { QueryClient } from "@tanstack/react-query"
import { isApiError } from "@/lib/errors"

// Retrying a 4xx only delays a message the user needs now — the request was
// wrong, and repeating it will not make it right. Server errors and requests
// that never landed (status 0) are worth two more attempts before giving up.
export function shouldRetry(count: number, err: unknown): boolean {
  return !isApiError(err) || err.status === 0 || err.status >= 500 ? count < 2 : false
}

// One instance for the whole app, so the 401 handler can drop every cached
// response belonging to the signed-out user.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetry },
  },
})
