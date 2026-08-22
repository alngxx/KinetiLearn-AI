import { ChevronDownIcon } from "lucide-react"
import type { FormField, Option } from "@/components/form/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

// A native select keeps keyboard and screen-reader behaviour correct for free;
// the styling matches Input so it does not read as a browser default.
const selectClasses =
  "h-8 w-full appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"

export function FieldRow({
  field,
  value,
  error,
  options,
  onChange,
}: {
  field: FormField
  value: string
  error?: string
  options?: Option[]
  onChange: (value: string) => void
}) {
  const errorId = `${field.name}-error`
  const helpId = `${field.name}-help`
  // Both are announced when both exist: the help text explains the rule, the
  // error says what is currently wrong with it.
  const describedBy =
    [field.helpText === undefined ? null : helpId, error === undefined ? null : errorId]
      .filter((id): id is string => id !== null)
      .join(" ") || undefined
  const required = field.required === true

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={field.name} className="text-sm font-medium">
        {field.label}
        {required && (
          <span aria-hidden="true" className="text-muted-foreground">
            *
          </span>
        )}
      </Label>

      {field.kind === "textarea" ? (
        <Textarea
          id={field.name}
          name={field.name}
          value={value}
          placeholder={field.placeholder}
          aria-required={required}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.kind === "select" ? (
        <div className="relative">
          <select
            id={field.name}
            name={field.name}
            value={value}
            aria-required={required}
            aria-invalid={error !== undefined}
            aria-describedby={describedBy}
            className={cn(selectClasses)}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">{field.required === true ? "Choose one" : "None"}</option>
            {(options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      ) : (
        <Input
          id={field.name}
          name={field.name}
          type={field.kind === "number" ? "number" : field.kind === "password" ? "password" : field.kind === "email" ? "email" : field.kind === "date" ? "date" : "text"}
          inputMode={field.kind === "number" ? "numeric" : undefined}
          autoComplete={
            field.kind === "password" ? "new-password" : field.kind === "email" ? "email" : "off"
          }
          spellCheck={field.kind === "email" ? false : undefined}
          value={value}
          placeholder={field.placeholder}
          aria-required={required}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className={field.kind === "number" ? "numeric" : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      {/* Help stays put when an error appears; both are referenced by
          aria-describedby rather than one replacing the other. */}
      {field.helpText !== undefined && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {field.helpText}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
