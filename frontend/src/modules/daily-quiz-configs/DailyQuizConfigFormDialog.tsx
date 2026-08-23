import { FieldRow } from "@/components/form/FieldRow"
import { buildPayload } from "@/components/form/helpers"
import type { FormField, FormValues, Option } from "@/components/form/types"
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
import type { DailyQuizConfigRow } from "@/modules/daily-quiz-configs/api"

export const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh"

const CLEAR_UNSUPPORTED =
  "Clearing this field is not supported by the API yet — contact engineering if it needs to be removed."

// Ordered so full-width fields (prompt, the document picker, the expiry
// explanation) get their own row and the rest pair up two-up with nothing
// left dangling in an empty cell.
const QUIZ_FIELDS: FormField[] = [
  { name: "name", label: "Name", kind: "text", required: true, maxLength: 150 },
  {
    name: "question_count",
    label: "Question count",
    kind: "number",
    required: true,
    helpText: "1–50 questions.",
  },
  {
    name: "prompt",
    label: "Prompt",
    kind: "textarea",
    required: true,
    placeholder: "What the quiz should cover, in the generator's own words…",
  },
  {
    name: "source_document_id",
    label: "Source document",
    kind: "select",
    required: true,
    optionsFrom: "source_document",
  },
]

const SCHEDULE_FIELDS: FormField[] = [
  { name: "start_date", label: "Start date", kind: "date", required: true },
  {
    name: "end_date",
    label: "End date",
    kind: "date",
    helpText: "Leave blank for a config that runs open-ended.",
  },
  { name: "push_time", label: "Push time", kind: "time", required: true },
  {
    name: "timezone",
    label: "Timezone",
    kind: "select",
    required: true,
    optionsFrom: "timezone",
  },
  {
    name: "expiry_hours",
    label: "Expiry (hours)",
    kind: "number",
    required: true,
    helpText: "How long a pushed quiz stays open before it expires.",
  },
]

const AUDIENCE_FIELDS: FormField[] = [
  {
    name: "target_department_id",
    label: "Department",
    kind: "select",
    optionsFrom: "departments",
  },
  {
    name: "target_seniority_id",
    label: "Seniority",
    kind: "select",
    optionsFrom: "seniority_levels",
  },
  {
    name: "target_job_position_id",
    label: "Job position",
    kind: "select",
    optionsFrom: "job_positions",
  },
  {
    name: "target_employee_level_id",
    label: "Employee level",
    kind: "select",
    optionsFrom: "employee_levels",
  },
]

const GROUPS: { title: string; fields: FormField[] }[] = [
  { title: "Quiz", fields: QUIZ_FIELDS },
  { title: "Schedule", fields: SCHEDULE_FIELDS },
  { title: "Audience", fields: AUDIENCE_FIELDS },
]

const FULL_WIDTH_FIELDS = new Set(["prompt", "source_document_id", "expiry_hours"])

// update() drops nulls (model_dump(exclude_none = True)), so clearing one of
// these on an existing config saves cleanly and changes nothing on the
// server. Say so on the fields where that can actually happen.
const CLEARABLE_ON_EDIT = new Set([
  "end_date",
  "target_department_id",
  "target_seniority_id",
  "target_job_position_id",
  "target_employee_level_id",
])

export function fieldsFor(
  row: DailyQuizConfigRow | null,
): { title: string; fields: FormField[] }[] {
  if (row === null) return GROUPS

  return GROUPS.map((group) => ({
    title: group.title,
    fields: group.fields.map((field) => {
      if (!CLEARABLE_ON_EDIT.has(field.name)) return field
      const current = (row as unknown as Record<string, unknown>)[field.name]
      if (current === null || current === undefined || current === "") return field
      return { ...field, helpText: CLEAR_UNSUPPORTED }
    }),
  }))
}

// Mirrors the server's own 400 (DailyQuizConfigService._check_dates) so a bad
// range is caught before the request; the server stays the authority.
export function validateRange(values: FormValues): Record<string, string> {
  const start = values.start_date ?? ""
  const end = values.end_date ?? ""
  if (start === "" || end === "") return {}
  if (end < start) return { end_date: "Must be on or after the start date." }
  return {}
}

function initialValues(fields: FormField[], row: DailyQuizConfigRow | null): FormValues {
  const values: FormValues = {}
  for (const field of fields) {
    if (row === null) {
      values[field.name] =
        field.name === "question_count"
          ? "5"
          : field.name === "expiry_hours"
            ? "24"
            : field.name === "timezone"
              ? DEFAULT_TIMEZONE
              : ""
      continue
    }
    const current = (row as unknown as Record<string, unknown>)[field.name]
    if (current === null || current === undefined) {
      values[field.name] = ""
    } else if (field.name === "push_time") {
      // Response carries "HH:MM:SS"; <input type="time"> wants "HH:MM".
      values[field.name] = String(current).slice(0, 5)
    } else {
      values[field.name] = String(current)
    }
  }
  return values
}

export function DailyQuizConfigFormDialog({
  row,
  options,
  open,
  onOpenChange,
  onSave,
}: {
  row: DailyQuizConfigRow | null
  options: Record<string, Option[]>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (id: string | undefined, body: Record<string, unknown>) => Promise<void>
}) {
  const mode = row === null ? "create" : "edit"
  const groups = fieldsFor(row)
  const fields = groups.flatMap((group) => group.fields)

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New daily quiz config" : `Edit ${row?.name}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Set what the quiz covers, when it runs, and who it reaches."
              : "Change the details and save."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex max-h-[65vh] flex-col gap-6 overflow-y-auto py-1"
          onSubmit={(event) => {
            event.preventDefault()
            void form.submit()
          }}
        >
          {groups.map((group) => (
            <fieldset key={group.title} className="flex flex-col gap-4">
              <legend className="label-micro mb-1">{group.title}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <div
                    key={field.name}
                    className={FULL_WIDTH_FIELDS.has(field.name) ? "sm:col-span-2" : undefined}
                  >
                    <FieldRow
                      field={field}
                      value={form.values[field.name] ?? ""}
                      error={form.errors[field.name]}
                      options={
                        field.optionsFrom === undefined ? undefined : options[field.optionsFrom]
                      }
                      onChange={(value) => form.setValue(field.name, value)}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
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
