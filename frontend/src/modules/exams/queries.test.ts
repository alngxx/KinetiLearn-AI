import { describe, expect, it } from "vitest"
import { JOB_POLL_INTERVAL_MS, isTerminal, pollIntervalFor } from "@/modules/exams/queries"

describe("isTerminal", () => {
  const cases = [
    { status: "queued", expected: false },
    { status: "running", expected: false },
    { status: "succeeded", expected: true },
    { status: "failed", expected: true },
  ]

  it.each(cases)("$status", ({ status, expected }) => {
    expect(isTerminal(status)).toBe(expected)
  })

  // The opposite of the documents module, where a missing status means "no
  // versions, nothing to wait for". Here it means the first response has not
  // arrived yet, so treating it as settled would drop the timer immediately.
  it("treats a missing status as not settled", () => {
    expect(isTerminal(undefined)).toBe(false)
    expect(isTerminal(null)).toBe(false)
  })
})

describe("pollIntervalFor", () => {
  it("polls while the worker still has the job", () => {
    expect(pollIntervalFor("queued")).toBe(JOB_POLL_INTERVAL_MS)
    expect(pollIntervalFor("running")).toBe(JOB_POLL_INTERVAL_MS)
    expect(pollIntervalFor(undefined)).toBe(JOB_POLL_INTERVAL_MS)
  })

  // Returning false rather than a number is what makes React Query drop the
  // timer instead of polling a finished job forever.
  it("stops once the job has settled", () => {
    expect(pollIntervalFor("succeeded")).toBe(false)
    expect(pollIntervalFor("failed")).toBe(false)
  })
})
