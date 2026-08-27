import { Badge } from "@/components/ui/badge"

export function ResultBadge({ isPassed }: { isPassed: boolean | null }) {
  if (isPassed === null) return <span className="text-muted-foreground">—</span>
  return (
    <Badge variant={isPassed ? "success" : "destructive"}>
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${isPassed ? "bg-success" : "bg-destructive"}`}
      />
      {isPassed ? "Passed" : "Failed"}
    </Badge>
  )
}
