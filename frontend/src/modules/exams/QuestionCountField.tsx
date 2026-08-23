import { ChevronDownIcon } from "lucide-react"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// The counts an admin actually reaches for. Anything else goes through Custom,
// which is still bounded by the server's own 1..50.
const PRESETS = [5, 10, 15, 20, 25, 30, 40, 50]

const CUSTOM = "custom"

// Matches FieldRow's select so the two read as the same control.
const selectClasses =
  "h-8 w-full appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

export function QuestionCountField({
  value,
  error,
  onChange,
}: {
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  const [custom, setCustom] = useState(() => !PRESETS.some((n) => String(n) === value))

  const errorId = "num_questions-error"
  const helpId = "num_questions-help"
  const describedBy = [helpId, error === undefined ? null : errorId]
    .filter((id): id is string => id !== null)
    .join(" ")

  function handleSelect(next: string) {
    if (next === CUSTOM) {
      // Keep whatever is there — switching to Custom to nudge 20 up to 22 should
      // not make the admin retype it.
      setCustom(true)
      return
    }
    setCustom(false)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="num_questions" className="text-sm font-medium">
        Questions
      </Label>

      <div className="relative">
        <select
          id="num_questions"
          name="num_questions"
          value={custom ? CUSTOM : value}
          aria-required="true"
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={selectClasses}
          onChange={(event) => handleSelect(event.target.value)}
        >
          {PRESETS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        <ChevronDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
      </div>

      {/* No min/max attributes on the input on purpose: native constraint
          validation would block submit before the form's own check runs, so the
          admin would get a browser tooltip instead of the message every other
          field uses. validateCount mirrors the server's bound and reports it
          in-page. */}
      {custom && (
        <Input
          type="number"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Number of questions"
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className="numeric w-28"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      <p id={helpId} className="text-xs text-muted-foreground">
      </p>
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
