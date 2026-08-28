import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll } from "vitest"
import { server } from "@/test/server"

// Recharts' ResponsiveContainer constructs one unconditionally, and jsdom has
// no implementation. It measures 0 either way, so the chart never renders here
// — the skill list carries the same numbers as text and is what the tests
// assert on.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))

afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
})

afterAll(() => server.close())
