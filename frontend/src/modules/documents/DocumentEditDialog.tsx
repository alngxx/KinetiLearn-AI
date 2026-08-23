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

// Metadata only. The file itself is never edited — a changed file is a new
// version, which is what the upload dialog is for.
//
// Category is required here even though the column is nullable: the update drops
// nulls (model_dump(exclude_none = True)), so an emptied select would save and
// silently change nothing. Requiring it means the field can be changed but not
// unset, which is the only honest option the API offers.
const FIELDS: FormField[] = [
  { name: "title", label: "Title", kind: "text", required: true, maxLength: 255 },
  {
    name: "category_id",
    label: "Category",
    kind: "select",
    required: true,
    optionsFrom: "categories",
  },
  {
    name: "description",
    label: "Description",
    kind: "textarea",
    placeholder: "What this document covers, in a sentence.",
  },
]

export type DocumentEditRow = {
  title: string
  category_id: string | null
  description?: string | null
}

function initialValues(row: DocumentEditRow): FormValues {
  return {
    title: row.title,
    category_id: row.category_id ?? "",
    description: row.description ?? "",
  }
}

export function DocumentEditDialog({
  row,
  options,
  open,
  onOpenChange,
  onSave,
}: {
  row: DocumentEditRow
  options: Record<string, Option[]>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (body: Record<string, unknown>) => Promise<void>
}) {
  const form = useEntityForm({
    fields: FIELDS,
    initial: initialValues(row),
    onSubmit: async (values) => {
      await onSave(buildPayload(FIELDS, values, "edit"))
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {row.title}</DialogTitle>
          <DialogDescription>
            Change how this document is listed and filed. Its versions, skills and
            processing are left alone.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-1"
          onSubmit={(event) => {
            event.preventDefault()
            void form.submit()
          }}
        >
          {FIELDS.map((field) => (
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
              {form.submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
