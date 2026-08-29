import type { LucideIcon } from "lucide-react"

// A section with nothing in it, sized to its content: one left-aligned row that
// lines up with the cards it replaces, rather than a tall centred void. The icon
// stays muted on purpose — brass is reserved for things worth acting on, and an
// empty section is the opposite of that.
export function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon
  title: string
  body: string
}) {
  return (
    <div className="flex items-start gap-3 surface px-5 py-6">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <Icon className="size-4" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-prose text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}
