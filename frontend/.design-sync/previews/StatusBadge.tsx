import { StatusBadge } from "kinetilearn-frontend"

export function States() {
  return (
    <div className="flex items-center gap-3">
      <StatusBadge active={true} />
      <StatusBadge active={false} />
    </div>
  )
}
