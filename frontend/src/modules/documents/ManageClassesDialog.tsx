import { useEffect, useState } from "react"
import { CheckboxGroup } from "@/components/form/CheckboxGroup"
import type { Option } from "@/components/form/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isApiError } from "@/lib/errors"
import { validateClasses } from "@/modules/documents/UploadDialog"

// Class assignment is its own dialog rather than another row in the edit form:
// the edit form is a metadata PATCH built by buildPayload out of string values,
// and this is a list. Splitting them also keeps "which classes can see this"
// a deliberate action rather than something changed in passing while renaming.
export function ManageClassesDialog({
  title,
  classes,
  classesLoading,
  initialClassIds,
  open,
  onOpenChange,
  onSave,
}: {
  title: string
  classes: Option[]
  classesLoading: boolean
  initialClassIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (classIds: string[]) => Promise<void>
}) {
  const [classIds, setClassIds] = useState<string[]>(initialClassIds)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [focusGroup, setFocusGroup] = useState(false)

  // Focus moves from an effect rather than inside handleSubmit, for the same
  // reason useEntityForm does it: the error the group's aria-describedby points
  // at is only in the DOM once this render has committed.
  useEffect(() => {
    if (!focusGroup) return
    document.getElementById("classes")?.focus()
    setFocusGroup(false)
  }, [focusGroup])

  async function handleSubmit() {
    const problem = validateClasses(classIds)
    setError(problem)
    if (problem !== undefined) {
      setFocusGroup(true)
      return
    }
    setSaving(true)
    try {
      await onSave(classIds)
      onOpenChange(false)
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not save the classes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage classes for {title}</DialogTitle>
          <DialogDescription>
            Only the classes assigned here can use this document as an exam source.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-1"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <CheckboxGroup
            id="classes"
            legend="Classes"
            options={classes}
            selected={classIds}
            error={error}
            loading={classesLoading}
            emptyText="No active classes yet."
            onToggle={(value) => {
              setError(undefined)
              setClassIds((current) =>
                current.includes(value)
                  ? current.filter((id) => id !== value)
                  : [...current, value],
              )
            }}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" aria-busy={saving} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
