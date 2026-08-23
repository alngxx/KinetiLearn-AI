import { FieldRow } from "@/components/form/FieldRow"
import type { FormField } from "@/components/form/types"
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

const FIELDS: FormField[] = [
  { name: "title", label: "Title", kind: "text", required: true, maxLength: 255 },
]

// A dialog rather than an inline field: it inherits the same validation, error
// mapping and submitting state every other edit form in the console already
// uses, which an inline control would have to reimplement for one field.
export function ExerciseRenameDialog({
  title,
  open,
  onOpenChange,
  onRename,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRename: (title: string) => Promise<void>
}) {
  const form = useEntityForm({
    fields: FIELDS,
    initial: { title },
    onSubmit: async (values) => {
      await onRename(values.title.trim())
      onOpenChange(false)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Rename exam</DialogTitle>
          <DialogDescription>
            Only the title changes. The questions and the schedule are left alone.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 py-1"
          onSubmit={(event) => {
            event.preventDefault()
            void form.submit()
          }}
        >
          <FieldRow
            field={FIELDS[0]}
            value={form.values.title ?? ""}
            error={form.errors.title}
            onChange={(value) => form.setValue("title", value)}
          />

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
              {form.submitting ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
