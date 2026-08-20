import { Badge } from "@/components/ui/badge"

export function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "outline" : "ghost"} className={active ? "" : "text-muted-foreground"}>
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${active ? "bg-ring" : "bg-muted-foreground/50"}`}
      />
      {active ? "Active" : "Inactive"}
    </Badge>
  )
}
