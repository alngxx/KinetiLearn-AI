import { useState } from "react"
import { FieldRow } from "@/components/form/FieldRow"
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
import { Label } from "@/components/ui/label"
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  type UploadInput,
} from "@/modules/documents/api"

const FIELDS: FormField[] = [
  { name: "title", label: "Title", kind: "text", required: true, maxLength: 255 },
  { name: "category_id", label: "Category", kind: "select", required: true, optionsFrom: "categories" },
  {
    name: "description",
    label: "Description",
    kind: "textarea",
    placeholder: "What this document covers, in a sentence.",
    helpText: "Only used when this creates a new document.",
  },
  {
    name: "change_note",
    label: "Change note",
    kind: "text",
    helpText: "What changed in this version.",
  },
]

const ACCEPT = [".pdf", ".docx", ...ALLOWED_MIME_TYPES].join(",")

// The same two rules the server applies, worded the same way, so the message
// does not change depending on which side caught it.
export function validateFile(file: File | null): string | undefined {
  if (file === null) return "Choose a PDF or DOCX file."
  if (!ALLOWED_MIME_TYPES.includes(file.type)) return "File must be a PDF or DOCX"
  if (file.size > MAX_FILE_SIZE) return "File exceeds the 20 MB limit"
  return undefined
}

export function UploadDialog({
  options,
  open,
  onOpenChange,
  onUpload,
}: {
  options: Record<string, Option[]>
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpload: (input: UploadInput) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | undefined>(undefined)

  const form = useEntityForm({
    fields: FIELDS,
    initial: { title: "", category_id: "", description: "", change_note: "" },
    onSubmit: async (values) => {
      // The text fields passed, but the file is checked outside this hook, so
      // it is re-checked here rather than trusted.
      if (file === null || validateFile(file) !== undefined) return
      await onUpload({
        title: values.title.trim(),
        category_id: values.category_id,
        description: values.description.trim(),
        change_note: values.change_note.trim(),
        file,
      })
      onOpenChange(false)
    },
  })

  // Both checks run on every attempt so a blank form reports the missing file
  // and the missing title together, not one and then the other.
  function handleSubmit() {
    const problem = validateFile(file)
    setFileError(problem)
    // "file" only wins focus when it is the sole failure. A field error from
    // the hook always outranks this fallback, so a fully blank form focuses
    // Title, above the file input, rather than the file input itself. That is
    // accepted as-is: fixing it needs a second ordering concept in a hook with
    // 11 consumers, and the file error is still visible with its own
    // role="alert" either way — this is not a missed case.
    void form.submit(problem === undefined ? undefined : "file")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            PDF or DOCX, up to 20 MB. If the title and category match a document that
            already exists, this becomes its next version.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-1"
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file" className="text-sm font-medium">
              File
            </Label>
            <input
              id="file"
              name="file"
              type="file"
              accept={ACCEPT}
              aria-required="true"
              aria-invalid={fileError !== undefined}
              aria-describedby={fileError === undefined ? undefined : "file-error"}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground hover:file:text-ring focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30"
              onChange={(event) => {
                const chosen = event.target.files?.[0] ?? null
                setFile(chosen)
                setFileError(undefined)
              }}
            />
            {fileError !== undefined && (
              <p id="file-error" role="alert" className="text-xs text-destructive">
                {fileError}
              </p>
            )}
          </div>

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
            <Button type="submit" aria-busy={form.submitting} disabled={form.submitting}>
              {form.submitting ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
