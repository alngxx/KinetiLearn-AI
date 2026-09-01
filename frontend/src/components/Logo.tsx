import { cn } from "@/lib/utils"

// Compact glyph + wordmark for the app shell headers. Deliberately not the
// login page's BrandMark (modules/auth/LoginLandingPage.tsx): that one leans
// on --kl-* tokens scoped to [data-kl-landing] and a gradient/glow treatment
// built for a marketing surface. This one is flat and coloured entirely via
// currentColor, so it inherits whatever text colour the caller sets and
// carries no identity accent of its own.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sidebar-foreground", className)}>
      <span
        aria-hidden="true"
        className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-sidebar-border"
      >
        <span className="absolute top-[5px] left-[6px] h-3.5 w-[2px] bg-current" />
        <span
          className="absolute top-[5px] left-[8.5px] h-1.5 w-[7px] bg-current"
          style={{ clipPath: "polygon(100% 0,100% 32%,0 100%,0 62%)" }}
        />
        <span
          className="absolute top-[13px] left-[8.5px] h-1.5 w-[7px] bg-current"
          style={{ clipPath: "polygon(0 0,0 38%,100% 100%,100% 68%)" }}
        />
      </span>
      <span translate="no" className="text-sm font-semibold tracking-tight">
        KinetiLearn
      </span>
    </span>
  )
}
