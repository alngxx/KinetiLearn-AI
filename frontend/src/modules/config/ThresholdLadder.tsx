// The one place this console gets loud. A skill's two cut points are the whole
// point of the scoring engine, so they get drawn as the ladder they describe
// instead of sitting in two anonymous number columns.
export function ThresholdLadder({
  basicMax,
  intermediateMax,
}: {
  basicMax: number
  intermediateMax: number
}) {
  const intermediateSpan = Math.max(intermediateMax - basicMax, 0)
  // Advanced is unbounded, so it gets a fixed share and fades out rather than
  // pretending to have an upper edge.
  const advancedSpan = Math.max(basicMax + intermediateSpan, 1) * 0.35

  return (
    <div className="flex min-w-36 flex-col gap-1.5">
      {/* The bar and the bare numbers mean nothing read aloud, so the whole
          thing is hidden and this sentence carries it instead. */}
      <span className="sr-only">
        {`Basic up to ${basicMax}, intermediate up to ${intermediateMax}, advanced above ${intermediateMax}.`}
      </span>

      {/* Cool-to-warm progression: info blue at the foundational end, warming
          through violet, landing on the identity brass at mastery — three
          distinct hues so the bands read apart in both themes, not just as
          shades of one color the way primary/ring do in dark mode. */}
      <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div style={{ flexGrow: basicMax }} className="bg-info" />
        <div style={{ flexGrow: intermediateSpan }} className="bg-band-intermediate" />
        <div
          style={{ flexGrow: advancedSpan }}
          className="bg-gradient-to-r from-ring to-ring/15"
        />
      </div>
      <div
        aria-hidden="true"
        className="flex items-center gap-1 text-xs text-muted-foreground"
      >
        <span className="numeric text-foreground">{basicMax}</span>
        <span>·</span>
        <span className="numeric text-foreground">{intermediateMax}</span>
      </div>
    </div>
  )
}
