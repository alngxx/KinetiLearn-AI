import { Badge } from "@/components/ui/badge"

export function StatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "success" : "destructive"}>
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${active ? "bg-success" : "bg-destructive"}`}
      />
      {active ? "Active" : "Inactive"}
    </Badge>
  )
}
