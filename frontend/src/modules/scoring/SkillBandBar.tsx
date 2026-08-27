// Reuses ThresholdLadder's exact band vocabulary (config/ThresholdLadder.tsx) —
// info blue for basic, violet for intermediate, brass gradient for advanced —
// so a skill's bands read as the same idea wherever they appear. Unlike the
// ladder, this bar also plots where the learner actually lands: each skill
// keeps its own basic_max/intermediate_max, so this can't be a shared radial
// scale the way a radar chart would need.
export function SkillBandBar({
  score,
  basicMax,
  intermediateMax,
}: {
  score: number
  basicMax: number
  intermediateMax: number
}) {
  const intermediateSpan = Math.max(intermediateMax - basicMax, 0)
  // Advanced is unbounded, so it gets a fixed share and fades out rather than
  // pretending to have an upper edge — same rule the ladder uses.
  const advancedSpan = Math.max(basicMax + intermediateSpan, 1) * 0.35
  const totalSpan = basicMax + intermediateSpan + advancedSpan
  const markerPercent = totalSpan === 0 ? 0 : Math.min(100, (score / totalSpan) * 100)

  return (
    <div aria-hidden="true" className="relative flex h-1.5 min-w-36 rounded-full bg-muted">
      <div style={{ flexGrow: basicMax }} className="rounded-l-full bg-info" />
      <div style={{ flexGrow: intermediateSpan }} className="bg-band-intermediate" />
      <div
        style={{ flexGrow: advancedSpan }}
        className="rounded-r-full bg-gradient-to-r from-ring to-ring/15"
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm"
        style={{ left: `${markerPercent}%` }}
      />
    </div>
  )
}
