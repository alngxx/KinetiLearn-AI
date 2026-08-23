import { documentBlockedReason, MAX_DOCUMENTS, type DocumentRow } from "@/modules/exams/api"

export function DocumentPicker({
  rows,
  loading,
  selected,
  error,
  onToggle,
}: {
  rows: DocumentRow[]
  loading: boolean
  selected: string[]
  error?: string
  onToggle: (id: string) => void
}) {
  const atLimit = selected.length >= MAX_DOCUMENTS

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">Source documents</legend>

      <p id="documents-help" className="text-xs text-muted-foreground">
      </p>

      <div
        aria-describedby="documents-help"
        aria-invalid={error !== undefined}
        className="max-h-64 overflow-y-auto rounded-lg border border-input aria-invalid:border-destructive"
      >
        {loading ? (
          <p className="p-3 text-sm text-muted-foreground">Loading documents…</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            No documents yet. Upload one before generating an exam.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const blocked = documentBlockedReason(row)
              const checked = selected.includes(row.document_id)
              // A blocked document stays visible and says why: hiding it leaves
              // an admin hunting for an upload they know they made.
              const disabled = blocked !== null || (atLimit && !checked)

              return (
                <li key={row.document_id}>
                  <label
                    className={`flex cursor-pointer items-start gap-2.5 p-2.5 transition-colors hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:bg-transparent has-focus-visible:bg-muted/50`}
                  >
                    {/* Named by the document alone, so the version badge does
                        not run into the title in the accessible name; why it is
                        blocked is a description, which is what it is. */}
                    <input
                      type="checkbox"
                      name="document_ids"
                      value={row.document_id}
                      checked={checked}
                      disabled={disabled}
                      aria-label={row.title}
                      aria-describedby={
                        blocked === null ? undefined : `blocked-${row.document_id}`
                      }
                      onChange={() => onToggle(row.document_id)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--ring)] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm break-words text-foreground">{row.title}</span>
                      {blocked !== null && (
                        <span
                          id={`blocked-${row.document_id}`}
                          className="text-xs text-muted-foreground"
                        >
                          {blocked}
                        </span>
                      )}
                    </span>
                    {row.active_version_number !== null && (
                      <span
                        aria-hidden="true"
                        className="numeric ml-auto shrink-0 text-xs text-muted-foreground"
                      >
                        v{row.active_version_number}
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p aria-live="polite" className="text-xs text-muted-foreground">
        <span className="numeric text-foreground">{selected.length}</span> of {MAX_DOCUMENTS}{" "}
        selected{atLimit ? " — the limit" : ""}
      </p>

      {error !== undefined && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}
