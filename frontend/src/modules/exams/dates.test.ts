import { describe, expect, it } from "vitest"
import { toDateTimeLocal, toIso } from "@/modules/exams/dates"

// Whole-minute instants only: datetime-local carries no seconds, so that is the
// precision the round trip is defined at. Chosen to straddle a DST boundary in
// the northern and southern hemispheres either way.
const INSTANTS = [
  "2026-01-15T08:30:00.000Z",
  "2026-03-29T01:00:00.000Z",
  "2026-06-30T23:59:00.000Z",
  "2026-10-25T02:00:00.000Z",
  "2026-12-31T00:00:00.000Z",
]

describe("datetime round trip", () => {
  // Both assertions are timezone-agnostic, so this passes under any TZ rather
  // than only the one the machine running it happens to be set to.
  it("returns the same instant after a trip through the input value", () => {
    for (const iso of INSTANTS) {
      expect(toIso(toDateTimeLocal(iso))).toBe(iso)
      expect(new Date(toDateTimeLocal(iso)).getTime()).toBe(new Date(iso).getTime())
    }
  })

  it("formats exactly what datetime-local accepts", () => {
    for (const iso of INSTANTS) {
      expect(toDateTimeLocal(iso)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    }
  })

  it("reads the input value as local time, not UTC", () => {
    const local = "2026-03-02T09:00"
    const parsed = new Date(toIso(local))
    expect(parsed.getHours()).toBe(9)
    expect(parsed.getMinutes()).toBe(0)
  })
})
