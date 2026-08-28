import { describe, expect, it } from "vitest"
import type { SkillBreakdownItem } from "@/modules/scoring/api"
import {
  BASIC_RING,
  INTERMEDIATE_RING,
  bandProgress,
  hasAnyScore,
  toRadarPoints,
} from "@/modules/scoring/skillRadar"

function item(overrides: Partial<SkillBreakdownItem>): SkillBreakdownItem {
  return {
    skill_id: "sk1",
    skill_name: "Fire safety",
    category_id: "cat1",
    category_name: "Safety",
    cumulative_score: 0,
    current_level: "basic",
    basic_max: 200,
    intermediate_max: 500,
    last_updated_at: null,
    ...overrides,
  }
}

describe("bandProgress", () => {
  // The whole point of the normalisation: whatever a skill's own cut points
  // are, its ceilings land on the same two rings as every other skill's.
  it("puts both band ceilings on the shared rings whatever the skill's scale", () => {
    expect(bandProgress(200, 200, 500)).toBeCloseTo(BASIC_RING)
    expect(bandProgress(500, 200, 500)).toBeCloseTo(INTERMEDIATE_RING)

    expect(bandProgress(15, 15, 30)).toBeCloseTo(BASIC_RING)
    expect(bandProgress(30, 15, 30)).toBeCloseTo(INTERMEDIATE_RING)
  })

  it("maps zero to the centre", () => {
    expect(bandProgress(0, 200, 500)).toBe(0)
  })

  it("interpolates within a band", () => {
    expect(bandProgress(100, 200, 500)).toBeCloseTo(BASIC_RING / 2)
    expect(bandProgress(350, 200, 500)).toBeCloseTo((BASIC_RING + INTERMEDIATE_RING) / 2)
  })

  // Advanced is unbounded, so it gets the fixed 0.35 headroom the band bars
  // use and then stops rather than running off the chart.
  it("clamps an advanced score at the outer ring", () => {
    expect(bandProgress(675, 200, 500)).toBeCloseTo(100)
    expect(bandProgress(100000, 200, 500)).toBe(100)
    expect(bandProgress(600, 200, 500)).toBeGreaterThan(INTERMEDIATE_RING)
    expect(bandProgress(600, 200, 500)).toBeLessThan(100)
  })

  it("does not divide by zero on a degenerate band", () => {
    expect(bandProgress(5, 0, 0)).toBe(100)
    expect(bandProgress(0, 0, 0)).toBe(0)
    expect(bandProgress(5, 30, 30)).toBe(100)
    expect(bandProgress(0, 0, 10)).toBe(0)
  })
})

describe("toRadarPoints", () => {
  it("keeps the API's order and names the axis after the skill", () => {
    const points = toRadarPoints([
      item({ skill_name: "Alpha", cumulative_score: 200 }),
      item({ skill_id: "sk2", skill_name: "Beta", cumulative_score: 0 }),
    ])
    expect(points.map((p) => p.skill)).toEqual(["Alpha", "Beta"])
    expect(points[0].progress).toBeCloseTo(BASIC_RING)
    expect(points[1].progress).toBe(0)
  })
})

describe("hasAnyScore", () => {
  // A skill_scores row only exists once it has been credited points, so the
  // timestamp is the honest signal rather than the score being non-zero.
  it("is false only when nothing has ever been scored", () => {
    expect(hasAnyScore([item({}), item({ skill_id: "sk2" })])).toBe(false)
    expect(
      hasAnyScore([
        item({}),
        item({ skill_id: "sk2", cumulative_score: 30, last_updated_at: "2026-03-01T00:00:00Z" }),
      ]),
    ).toBe(true)
  })
})
