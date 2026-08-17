import { QueryClient } from "@tanstack/react-query"

// One instance for the whole app, so the 401 handler can drop every cached
// response belonging to the signed-out user.
export const queryClient = new QueryClient()
