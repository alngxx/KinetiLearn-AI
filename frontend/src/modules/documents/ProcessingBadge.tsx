import { Badge } from "@/components/ui/badge"
import { isTerminal } from "@/modules/documents/queries"

// The four states the pipeline writes. "Queued" and "Processing" both mean a
// worker still has the row, so both pulse with a muted dot; once it lands on
// Ready that settles into a solid info-blue "this is usable now" signal.
const LABELS: Record<string, string> = {
  pending: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
}

export function ProcessingBadge({ status }: { status: string | null | undefined }) {
  if (status === null || status === undefined) {
    return <span className="text-sm text-muted-foreground">No versions</span>
  }

  const label = LABELS[status] ?? status
  const failed = status === "failed"
  const working = !isTerminal(status)

  return (
    // role="status" makes each row its own polite live region, so a flip from
    // Processing to Ready is announced while the admin waits, without them
    // having to re-read the table.
    <Badge
      role="status"
      variant={failed ? "destructive" : working ? "outline" : "info"}
      className={working ? "text-muted-foreground" : undefined}
    >
      <span
        aria-hidden="true"
        className={[
          "size-1.5 rounded-full",
          failed ? "bg-destructive" : working ? "bg-muted-foreground" : "bg-info",
          working ? "motion-safe:animate-pulse" : "",
        ].join(" ")}
      />
      {label}
    </Badge>
  )
}
