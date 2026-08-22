import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isApiError } from "@/lib/errors"
import {
  hasEnrollFilter,
  type EnrollFilters,
  type EnrollResult,
  type LookupName,
} from "@/modules/classes/api"
import { useBulkAddMembers, useClassLookups, useEnrollPreview } from "@/modules/classes/queries"

const FILTERS: { name: keyof EnrollFilters; label: string; from: LookupName }[] = [
  { name: "department_id", label: "Department", from: "departments" },
  { name: "seniority_id", label: "Seniority", from: "seniority_levels" },
  { name: "employee_level_id", label: "Employee level", from: "employee_levels" },
]

const selectClasses =
  "h-8 w-full appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"

export function BulkEnrollDialog({
  classId,
  classTitle,
  open,
  onOpenChange,
}: {
  classId: string
  classTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [result, setResult] = useState<EnrollResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const lookups = useClassLookups()
  const add = useBulkAddMembers()

  const filters: EnrollFilters = {}
  for (const filter of FILTERS) {
    const value = chosen[filter.name] ?? ""
    if (value !== "") filters[filter.name] = value
  }
  const ready = hasEnrollFilter(filters)

  const preview = useEnrollPreview(filters)

  function handleSubmit() {
    setFailure(null)
    add.mutate(
      { id: classId, filters },
      {
        onSuccess: (added) => setResult(added),
        onError: (err) =>
          setFailure(isApiError(err) ? err.message : "Could not enrol anyone. Please try again."),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enrol people in {classTitle}</DialogTitle>
          <DialogDescription>
            Every active learner matching all of the filters you set is added. Anyone already in
            the class is skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {FILTERS.map((filter) => (
            <div key={filter.name} className="flex flex-col gap-1.5">
              <label htmlFor={`enrol-${filter.name}`} className="text-sm font-medium">
                {filter.label}
              </label>
              <select
                id={`enrol-${filter.name}`}
                value={chosen[filter.name] ?? ""}
                className={selectClasses}
                onChange={(event) =>
                  setChosen((current) => ({ ...current, [filter.name]: event.target.value }))
                }
              >
                <option value="">Any</option>
                {lookups[filter.from].map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {/* Counted before the write because the API has no dry run and no way
              to remove a member again. */}
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {!ready
              ? "Set at least one filter to see who matches."
              : preview.isPending
                ? "Counting…"
                : preview.isError
                  ? "Could not count who matches. Adding still reports the real numbers."
                  : preview.data === 0
                    ? "No one matches these filters."
                    : preview.data === 1
                      ? "1 person matches."
                      : `${preview.data} people match.`}
          </p>

          {result !== null && (
            <div role="status" className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium text-foreground">
                {result.added === 1 ? "1 person added" : `${result.added} people added`}
              </p>
              <p className="numeric mt-1 text-sm text-muted-foreground">
                {result.total_matched} matched · {result.added} added · {result.skipped} already in
                the class
              </p>
            </div>
          )}

          {failure !== null && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {result === null ? "Cancel" : "Done"}
          </Button>
          <Button type="button" disabled={!ready || add.isPending} onClick={handleSubmit}>
            {add.isPending ? "Adding…" : "Add to class"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
