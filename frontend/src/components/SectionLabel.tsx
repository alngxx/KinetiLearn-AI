// A micro-label carried out to the full column width by a hairline. The rule
// lets the eye pick up where a section starts without spending another heading
// weight on it, and it is decorative — the heading already says where we are.
export function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3">
      {/* Wider tracked and a half-step smaller than label-micro: on the learner
          screens these sit under a 44px hero, where the app-wide micro-label
          reads as a heading rather than as a rule marker. */}
      <h2 className="font-mono text-[10.5px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
        {children}
      </h2>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  )
}
