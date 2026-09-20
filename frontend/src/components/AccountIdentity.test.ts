import { describe, expect, it } from "vitest"
import { initialsFromName } from "@/components/AccountIdentity"

describe("initialsFromName", () => {
  it("takes the first and last word", () => {
    expect(initialsFromName("Nguyen Thi Thu Ha")).toBe("NH")
    expect(initialsFromName("Ada Lovelace")).toBe("AL")
  })

  it("gives one letter for a single-word name", () => {
    expect(initialsFromName("Prince")).toBe("P")
  })

  it("ignores surrounding and repeated whitespace", () => {
    expect(initialsFromName("  mary   jane  ")).toBe("MJ")
  })

  it("falls back rather than rendering an empty circle", () => {
    expect(initialsFromName("   ")).toBe("?")
  })
})
