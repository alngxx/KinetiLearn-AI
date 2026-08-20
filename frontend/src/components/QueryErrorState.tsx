import { RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/lib/errors"

// Shown in place of a table body when the list query fails. The API's own
// message is the explanation; the button is the way out.
export function QueryErrorState({
  title,
  error,
  retrying,
  onRetry,
}: {
  title: string
  error: unknown
  retrying: boolean
  onRetry: () => void
}) {
  const message = isApiError(error)
    ? error.message
    : "Something went wrong. Please try again."

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p role="alert" className="text-sm text-muted-foreground">
          {message}
        </p>
      </div>
      <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        <RefreshCwIcon className={retrying ? "motion-safe:animate-spin" : undefined} />
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  )
}
