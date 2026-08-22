import { describe, expect, it } from "vitest"
import { POLL_INTERVAL_MS, isTerminal, pollIntervalFor } from "@/modules/documents/queries"

describe("isTerminal", () => {
  const cases = [
    { status: "pending", expected: false },
    { status: "processing", expected: false },
    { status: "ready", expected: true },
    { status: "failed", expected: true },
  ]

  it.each(cases)("$status", ({ status, expected }) => {
    expect(isTerminal(status)).toBe(expected)
  })

  // A document with no versions yet reports null. Treating it as terminal is
  // what stops an empty list from polling forever.
  it("treats a missing status as terminal", () => {
    expect(isTerminal(null)).toBe(true)
    expect(isTerminal(undefined)).toBe(true)
  })
})

describe("pollIntervalFor", () => {
  it("polls while anything is queued or processing", () => {
    expect(pollIntervalFor(["pending"])).toBe(POLL_INTERVAL_MS)
    expect(pollIntervalFor(["processing"])).toBe(POLL_INTERVAL_MS)
    expect(pollIntervalFor(["ready", "processing", "failed"])).toBe(POLL_INTERVAL_MS)
  })

  // Returning false rather than a number is what makes React Query drop the
  // timer instead of refetching a settled document forever.
  it("stops once every version has settled", () => {
    expect(pollIntervalFor(["ready"])).toBe(false)
    expect(pollIntervalFor(["failed"])).toBe(false)
    expect(pollIntervalFor(["ready", "failed"])).toBe(false)
  })

  it("does not poll an empty list, or a document with no versions", () => {
    expect(pollIntervalFor([])).toBe(false)
    expect(pollIntervalFor([null])).toBe(false)
  })
})
