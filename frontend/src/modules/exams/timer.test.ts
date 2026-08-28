import { describe, expect, it } from "vitest"
import { deadlineFor, formatCountdown } from "@/modules/exams/timer"

const MOUNTED = Date.parse("2026-08-20T10:00:00.000Z")

describe("deadlineFor", () => {
  it("uses the learner's own window while the exam is open well past it", () => {
    const deadline = deadlineFor(MOUNTED, 30, "2026-08-20T17:00:00.000Z")
    expect(deadline).toBe(MOUNTED + 30 * 60_000)
  })

  it("uses the closing time when that comes first", () => {
    const closes = "2026-08-20T10:10:00.000Z"
    expect(deadlineFor(MOUNTED, 30, closes)).toBe(Date.parse(closes))
  })

  // Opening an exam that has already closed is allowed — the server accepts a
  // late submission and only flags it — so this is a real case, not a guard.
  it("is already past when the exam closed before the page opened", () => {
    expect(deadlineFor(MOUNTED, 30, "2026-08-20T09:00:00.000Z")).toBeLessThan(MOUNTED)
  })
})

describe("formatCountdown", () => {
  it("drops the hour until there is one", () => {
    expect(formatCountdown(30 * 60_000)).toBe("30:00")
    expect(formatCountdown(90_000)).toBe("1:30")
    expect(formatCountdown(59 * 60_000 + 59_000)).toBe("59:59")
    expect(formatCountdown(60 * 60_000)).toBe("1:00:00")
    expect(formatCountdown(125 * 60_000)).toBe("2:05:00")
  })

  // Expiry is a state the page renders, so this never returns a negative time.
  it("clamps at zero", () => {
    expect(formatCountdown(0)).toBe("0:00")
    expect(formatCountdown(-90_000)).toBe("0:00")
  })

  // Rounding up, so a timer started at 30 minutes reads 30:00 rather than
  // 29:59 on its first frame.
  it("rounds part-seconds up", () => {
    expect(formatCountdown(29_999)).toBe("0:30")
  })
})
