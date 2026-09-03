import { cn } from "@/lib/utils"

// Compact glyph + wordmark for the app shell headers. Deliberately not the
// login page's BrandMark (modules/auth/LoginLandingPage.tsx): that one leans
// on --kl-* tokens scoped to [data-kl-landing] and a gradient/glow treatment
// built for a marketing surface. This one is flat and coloured entirely via
// currentColor, so it inherits whatever text colour the caller sets — but it
// shares BrandMark's kl-kinetic pulse (the identity indigo, via --ring) so the
// mark reads as one brand across the login page and both portals. Unconditional
// on every render: this is the app's one persistent brand cue, not tied to a
// route or a theme.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-sidebar-foreground", className)}>
      {/* bg-card gives the tile an actual fill — BrandMark's own tile is
          opaque for the same reason: drop-shadow silhouettes an element's
          painted pixels, and a border plus three thin bars on a transparent
          background barely have a shape to cast a shadow around. Without
          this the kl-kinetic pulse below is technically running but reads
          as no visible glow at all. */}
      <span
        aria-hidden="true"
        className="relative inline-flex size-[34px] shrink-0 items-center justify-center rounded-[7px] border border-sidebar-border bg-card"
        style={{ animation: "kl-kinetic 4.4s ease-in-out infinite" }}
      >
        <span className="absolute top-[9px] left-[10px] h-4 w-[2.5px] bg-current" />
        <span
          className="absolute top-[9px] left-[14px] h-[7.5px] w-2 bg-current"
          style={{ clipPath: "polygon(100% 0,100% 32%,0 100%,0 62%)" }}
        />
        <span
          className="absolute top-[17.5px] left-[14px] h-[7.5px] w-2 bg-current"
          style={{ clipPath: "polygon(0 0,0 38%,100% 100%,100% 68%)" }}
        />
      </span>
      <span translate="no" className="text-xl font-bold tracking-[-0.035em]">
        KinetiLearn
      </span>
    </span>
  )
}
