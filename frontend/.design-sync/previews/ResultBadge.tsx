import { ResultBadge } from "kinetilearn-frontend"

export function States() {
  return (
    <div className="flex items-center gap-3">
      <ResultBadge isPassed={true} />
      <ResultBadge isPassed={false} />
      <ResultBadge isPassed={null} />
    </div>
  )
}
