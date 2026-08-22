import { FieldRow } from "@/components/form/FieldRow"
import { buildPayload } from "@/components/form/helpers"
import type { FormField, FormValues } from "@/components/form/types"
import { useEntityForm } from "@/components/form/useEntityForm"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ClassRow } from "@/modules/classes/api"

const OPEN_ENDED_HELP = "Leave both blank for a class that runs open-ended."

const CLEAR_UNSUPPORTED =
  "Clearing this field is not supported by the API yet — contact engineering if it needs to be removed."

const FIELDS: FormField[] = [
  { name: "name", label: "Name", kind: "text", required: true, maxLength: 150 },
  {
    name: "description",
    label: "Description",
    kind: "textarea",
    placeholder: "e.g. New joiners starting in March…",
  },
  { name: "start_date", label: "Start date", kind: "date" },
  {
    name: "end_date",
    label: "End date",
    kind: "date",
    helpText: OPEN_ENDED_HELP,
  },
]

// The update endpoint drops nulls (model_dump(exclude_none = True)), so emptying
// a date that already has one saves cleanly and changes nothing on the server.
// Say so on the fields where that can actually happen rather than letting the
// form report a success it did not deliver. An already-empty date has nothing to
// warn about, and the open-ended hint is replaced because it would contradict
// the warning.
export function fieldsFor(row: ClassRow | null): FormField[] {
  if (row === null) return FIELDS

  return FIELDS.map((field) => {
    if (field.kind !== "date") return field
    const current = (row as Record<string, unknown>)[field.name]
    if (current === null || current === undefined || current === "") return field
    return { ...field, helpText: CLEAR_UNSUPPORTED }
  })
}

// Mirrors the server's own 400 so a bad range is caught before the request; the
// server stays the authority if anything gets past this.
export function validateRange(values: FormValues): Record<string, string> {
  const start = values.start_date ?? ""
  const end = values.end_date ?? ""
  if (start === "" || end === "") return {}
  if (end < start) return { end_date: "Must be on or after the start date." }
  return {}
}

function initialValues(fields: FormField[], row: ClassRow | null): FormValues {
  const values: FormValues = {}
  for (const field of fields) {
    const current = row === null ? undefined : (row as Record<string, unknown>)[field.name]
    values[field.name] = current === null || current === undefined ? "" : String(current)
  }
  return values
}

export function ClassFormDialog({
  row,
  open,
  onOpenChange,
  onSave,
}: {
  row: ClassRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (id: string | undefined, body: Record<string, unknown>) => Promise<void>
}) {
  const mode = row === null ? "create" : "edit"
  const fields = fieldsFor(row)

  const form = useEntityForm({
    fields,
    initial: initialValues(fields, row),
    validate: validateRange,
    onSubmit: async (values) => {
      await onSave(row?.id, buildPayload(fields, values, mode))
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New class" : `Edit ${row?.name}`}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create the cohort first, then enrol people into it from its page."
              : "Change the details and save. Members and exercises are left alone."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-1"
          onSubmit={(event) => {
            event.preventDefault()
            void form.submit()
          }}
        >
          {fields.map((field) => (
            <FieldRow
              key={field.name}
              field={field}
              value={form.values[field.name] ?? ""}
              error={form.errors[field.name]}
              onChange={(value) => form.setValue(field.name, value)}
            />
          ))}

          {form.formError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {form.formError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.submitting}>
              {form.submitting ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
