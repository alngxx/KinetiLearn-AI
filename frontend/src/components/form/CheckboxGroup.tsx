import type { Option } from "@/components/form/types"

// The shared form hook holds FormValues as Record<string, string>, so a
// multi-value field cannot live in it — every one of these keeps its own state
// beside the form, the way GenerateExamPage already does. Markup follows
// DocumentPicker so the two read as the same control.
export function CheckboxGroup({
  id,
  legend,
  options,
  selected,
  error,
  loading = false,
  emptyText,
  onToggle,
}: {
  id: string
  legend: string
  options: Option[]
  selected: string[]
  error?: string
  loading?: boolean
  emptyText: string
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">{legend}</legend>

      <div
        id={id}
        tabIndex={-1}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
        className="max-h-48 overflow-y-auto rounded-lg border border-input outline-none aria-invalid:border-destructive"
      >
        {loading ? (
          <p role="status" className="p-3 text-sm text-muted-foreground">
            Loading…
          </p>
        ) : options.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-border">
            {options.map((option) => (
              <li key={option.value}>
                <label className="flex cursor-pointer items-start gap-2.5 p-2.5 transition-colors hover:bg-muted/50 has-focus-visible:bg-muted/50">
                  <input
                    type="checkbox"
                    name={id}
                    value={option.value}
                    checked={selected.includes(option.value)}
                    aria-label={option.label}
                    onChange={() => onToggle(option.value)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--ring)] outline-none focus-visible:ring-3 focus-visible:ring-ring/75"
                  />
                  <span className="min-w-0 text-sm break-words text-foreground">
                    {option.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p aria-live="polite" className="text-xs text-muted-foreground">
        <span className="numeric text-foreground">{selected.length}</span> selected
      </p>

      {error !== undefined && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}
