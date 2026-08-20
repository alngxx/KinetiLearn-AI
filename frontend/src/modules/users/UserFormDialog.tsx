import { FieldRow } from "@/components/form/FieldRow"
import { buildPayload } from "@/components/form/helpers"
import type { FormField, Option } from "@/components/form/types"
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
import type { UserRow } from "@/modules/users/api"

const TAG_FIELDS: FormField[] = [
  { name: "department_id", label: "Department", kind: "select", optionsFrom: "departments" },
  { name: "seniority_id", label: "Seniority", kind: "select", optionsFrom: "seniority_levels" },
  {
    name: "job_position_id",
    label: "Job position",
    kind: "select",
    optionsFrom: "job_positions",
  },
  {
    name: "employee_level_id",
    label: "Employee level",
    kind: "select",
    optionsFrom: "employee_levels",
  },
]

// Password is create-only, and the API offers no way to change a role after the
// fact, so role is create-only too.
export function fieldsForMode(mode: "create" | "edit"): FormField[] {
  const identity: FormField[] = [
    { name: "email", label: "Email", kind: "email", required: true },
    { name: "full_name", label: "Full name", kind: "text", required: true, maxLength: 100 },
  ]

  if (mode === "edit") return [...identity, ...TAG_FIELDS]

  return [
    ...identity,
    {
      name: "password",
      label: "Password",
      kind: "password",
      required: true,
      minLength: 8,
      helpText: "At least 8 characters. Share it with them directly.",
    },
    {
      name: "role",
      label: "Role",
      kind: "select",
      required: true,
      optionsFrom: "roles",
      helpText: "Roles cannot be changed after the account is created.",
    },
    ...TAG_FIELDS,
  ]
}

function initialValues(fields: FormField[], row: UserRow | null): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    const current = row === null ? undefined : (row as Record<string, unknown>)[field.name]
    values[field.name] = current === null || current === undefined ? "" : String(current)
  }
  if (row === null) values.role = "learner"
  return values
}

export function UserFormDialog({
  row,
  options,
  open,
  onOpenChange,
  onSave,
}: {
  row: UserRow | null
  options: Record<string, Option[]>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (id: string | undefined, body: Record<string, unknown>) => Promise<void>
}) {
  const mode = row === null ? "create" : "edit"
  const fields = fieldsForMode(mode)

  const form = useEntityForm({
    fields,
    initial: initialValues(fields, row),
    onSubmit: async (values) => {
      await onSave(row?.id, buildPayload(fields, values, mode))
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New person" : `Edit ${row?.full_name}`}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create an account and tag it so classes and quizzes can target it."
              : "Change their details and save."}
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
              options={field.optionsFrom === undefined ? undefined : options[field.optionsFrom]}
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
