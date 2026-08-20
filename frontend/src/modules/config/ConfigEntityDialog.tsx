import { FieldRow } from "@/components/form/FieldRow"
import { buildPayload } from "@/components/form/helpers"
import type { Option } from "@/components/form/types"
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
import type { ConfigRow } from "@/modules/config/api"
import type { ConfigEntityDescriptor } from "@/modules/config/descriptors"

// An edit form starts from the row; a create form starts empty.
function initialValues(
  descriptor: ConfigEntityDescriptor,
  row: ConfigRow | null,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of descriptor.formFields) {
    const current = row === null ? undefined : (row as Record<string, unknown>)[field.name]
    values[field.name] =
      current === null || current === undefined ? "" : String(current)
  }
  return values
}

export function ConfigEntityDialog({
  descriptor,
  row,
  options,
  open,
  onOpenChange,
  onSave,
}: {
  descriptor: ConfigEntityDescriptor
  row: ConfigRow | null
  options: Record<string, Option[]>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (id: string | undefined, body: Record<string, unknown>) => Promise<void>
}) {
  const mode = row === null ? "create" : "edit"

  const form = useEntityForm({
    fields: descriptor.formFields,
    initial: initialValues(descriptor, row),
    validate: descriptor.validate,
    onSubmit: async (values) => {
      await onSave(row?.id, buildPayload(descriptor.formFields, values, mode))
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? `New ${descriptor.singular.toLowerCase()}` : `Edit ${row?.name}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? `Add a ${descriptor.singular.toLowerCase()} to the ${descriptor.label.toLowerCase()} list.`
              : "Change the details and save."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 py-1"
          onSubmit={(event) => {
            event.preventDefault()
            void form.submit()
          }}
        >
          {descriptor.formFields.map((field) => (
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
