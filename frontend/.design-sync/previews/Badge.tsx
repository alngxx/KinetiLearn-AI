import { Badge } from "kinetilearn-frontend"

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Draft</Badge>
      <Badge variant="secondary">Processing</Badge>
      <Badge variant="success">Published</Badge>
      <Badge variant="destructive">Failed</Badge>
      <Badge variant="info">Scheduled</Badge>
      <Badge variant="outline">Archived</Badge>
    </div>
  )
}

export function WithDot() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="success">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
        Active
      </Badge>
      <Badge variant="destructive">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-destructive" />
        Inactive
      </Badge>
    </div>
  )
}
