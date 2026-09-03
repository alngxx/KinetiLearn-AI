// The learner shell's hero. Deliberately not PageHeader: that one is the admin
// console's row — a 24px title with a rule under it, sized to sit above dense
// tables — and both portals share it. This one is built for the sky band, where
// the title is the only thing in a 292px field and has to hold it. The vertical
// rhythm is load-bearing: the horizon rule is a fixed offset from the top of the
// viewport, and this block's height is what puts it in the gap below.
//
// No bottom border — the horizon rule is the divider up here.
export function PortalHero({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <header className="flex flex-col gap-3 pt-10 pb-10 md:pt-13 md:pb-[3.625rem]">
      {/* Brighter than label-micro's muted grey and wider tracked: over the
          band this is the one piece of type carrying the accent. */}
      <span className="font-mono text-[10.5px] font-medium tracking-[0.2em] text-[color-mix(in_oklab,var(--ring)_72%,var(--muted-foreground))] uppercase">
        {eyebrow}
      </span>
      <h1 className="text-[2rem] leading-[1.02] font-[750] tracking-[-0.038em] text-balance text-foreground md:text-[2.75rem]">
        {title}
      </h1>
      {description !== undefined && description !== "" && (
        <p className="max-w-[46ch] text-[15px] leading-[1.6] text-pretty text-muted-foreground">
          {description}
        </p>
      )}
    </header>
  )
}
