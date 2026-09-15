import { describe, expect, it } from "vitest"
import { truncateToFit } from "@/lib/useClampedText"

// A stand-in for real pixel measurement: fits iff the candidate's length is
// within budget. Good enough to exercise the search without a layout engine.
function fitsWithin(budget: number) {
  return (candidate: string) => candidate.length <= budget
}

describe("truncateToFit", () => {
  it("returns the text unchanged when it already fits", () => {
    expect(truncateToFit("short text", fitsWithin(50))).toBe("short text")
  })

  it("cuts at the last whole word that fits, not mid-word", () => {
    const text = "Delegate multi-step work to Claude in Cowork"
    const result = truncateToFit(text, fitsWithin(20))

    expect(result.endsWith("…")).toBe(true)
    const withoutEllipsis = result.slice(0, -1)
    // Every word in the result must be a real word from the source text —
    // never a fragment of one.
    for (const word of withoutEllipsis.split(" ")) {
      expect(text.split(" ")).toContain(word)
    }
  })

  it("picks the longest prefix that fits, not a shorter one", () => {
    const text = "one two three four five"
    // "one two…" is 8 chars, "one two three…" is 14 chars.
    const result = truncateToFit(text, fitsWithin(10))
    expect(result).toBe("one two…")
  })

  it("falls back to a bare ellipsis when not even one word fits", () => {
    expect(truncateToFit("word", fitsWithin(0))).toBe("…")
  })

  it("never re-adds a trailing ellipsis to text that already fits whole", () => {
    expect(truncateToFit("exact", fitsWithin(5))).toBe("exact")
  })
})
