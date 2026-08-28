import type { SkillBreakdownItem } from "@/modules/scoring/api"

// A radar has one radial scale, but every skill carries its own basic_max and
// intermediate_max, so raw scores cannot share an axis. Each skill is mapped
// onto the same 0-100 band-progress scale instead: 0 at zero, 33.33 at the
// basic ceiling, 66.67 at the intermediate ceiling. One ring then means the
// same thing on every axis, which is how the threshold information survives
// the move from SkillBandBar's horizontal bar to radar geometry.
export const BASIC_RING = 100 / 3
export const INTERMEDIATE_RING = 200 / 3

// Advanced is unbounded, so it gets a fixed share of the scale and the chart
// stops there rather than pretending to have an upper edge — the same 0.35
// rule ThresholdLadder and SkillBandBar use.
const ADVANCED_HEADROOM = 0.35

export function bandProgress(
  score: number,
  basicMax: number,
  intermediateMax: number,
): number {
  if (score <= 0) return 0

  // The schema forbids both of these, but the chart must not divide by zero if
  // one ever slips through.
  if (intermediateMax <= 0 || intermediateMax <= basicMax) {
    return score > 0 ? 100 : 0
  }

  if (score <= basicMax) {
    // A skill whose basic band is zero-wide has no room below its ceiling.
    if (basicMax <= 0) return 0
    return (score / basicMax) * BASIC_RING
  }

  if (score <= intermediateMax) {
    const into = (score - basicMax) / (intermediateMax - basicMax)
    return BASIC_RING + into * (INTERMEDIATE_RING - BASIC_RING)
  }

  const advancedSpan = intermediateMax * ADVANCED_HEADROOM
  const into = (score - intermediateMax) / advancedSpan
  return Math.min(100, INTERMEDIATE_RING + into * (100 - INTERMEDIATE_RING))
}

export type RadarPoint = {
  skill: string
  progress: number
}

export function toRadarPoints(items: SkillBreakdownItem[]): RadarPoint[] {
  return items.map((item) => ({
    skill: item.skill_name,
    progress: bandProgress(item.cumulative_score, item.basic_max, item.intermediate_max),
  }))
}

// A score row only ever exists once it has been credited points, so a null
// last_updated_at is exactly "never scored" — it does not need to be inferred
// from the score being zero.
export function hasAnyScore(items: SkillBreakdownItem[]): boolean {
  return items.some((item) => item.last_updated_at !== null)
}

// Under three axes there is no polygon to draw, only a dot or a line, which
// reads as broken rather than as data.
export const MIN_RADAR_AXES = 3
