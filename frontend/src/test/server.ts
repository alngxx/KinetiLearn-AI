import { setupServer } from "msw/node"

// Handlers are registered per test with server.use(...).
export const server = setupServer()
