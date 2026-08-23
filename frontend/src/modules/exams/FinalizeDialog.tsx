import { FieldRow } from "@/components/form/FieldRow"
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
import type { Exercise, FinalizeInput } from "@/modules/exams/api"
import { toDateTimeLocal, toIso } from "@/modules/exams/dates"

const FIELDS: FormField[] = [
  { name: "start_time", label: "Opens", kind: "datetime", required: true },
  { name: "end_time", label: "Closes", kind: "datetime", required: true },
  {
    name: "duration_minutes",
    label: "Time limit",
    kind: "number",
    required: true,
    helpText: "Minutes a learner gets once they start.",
  },
  {
    name: "pass_score",
    label: "Pass mark",
    kind: "number",
    required: true,
  },
]

// The four rules finalize enforces, worded as the server words them so the
// message does not change depending on which side caught it. The server stays
// the authority if anything gets past this.
export function validateSchedule(values: FormValues, totalPoints: number): Record<string, string> {
  const errors: Record<string, string> = {}

  const start = values.start_time ?? ""
  const end = values.end_time ?? ""
  if (start !== "" && end !== "" && new Date(start).getTime() >= new Date(end).getTime()) {
    errors.end_time = "start_time must be before end_time"
  }

  const duration = Number(values.duration_minutes ?? "")
  if (values.duration_minutes !== "" && (!Number.isInteger(duration) || duration <= 0)) {
    errors.duration_minutes = "duration_minutes must be greater than 0"
  }

  // Checked against the live sum of question points, not the stored
  // total_points — finalize recomputes it, so editing points after generation
  // moves this ceiling.
  const pass = Number(values.pass_score ?? "")
  if (values.pass_score !== "" && Number.isInteger(pass) && pass > totalPoints) {
    errors.pass_score = "pass_score cannot exceed total_points"
  }

  return errors
}

export function FinalizeDialog({
  exercise,
  totalPoints,
  open,
  onOpenChange,
  onFinalize,
}: {
  exercise: Exercise
  totalPoints: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onFinalize: (body: FinalizeInput) => Promise<void>
}) {
  const form = useEntityForm({
    fields: FIELDS,
    // Generation leaves a placeholder schedule behind on first finalize; after an
    // unpublish it is the previous real schedule instead. Either way it is the
    // starting point here rather than an empty form the admin has to fill from nothing.
    initial: {
      start_time: toDateTimeLocal(exercise.start_time),
      end_time: toDateTimeLocal(exercise.end_time),
      duration_minutes: String(exercise.duration_minutes),
      pass_score: String(exercise.pass_score),
    },
    validate: (values) => validateSchedule(values, totalPoints),
    onSubmit: async (values) => {
      await onFinalize({
        start_time: toIso(values.start_time),
        end_time: toIso(values.end_time),
        duration_minutes: Number(values.duration_minutes),
        pass_score: Number(values.pass_score),
      })
      onOpenChange(false)
    },
  })

  // The server has no rule against a start in the past — it simply opens
  // straight away — so this says what will happen rather than blocking it.
  const startsInThePast =
    form.values.start_time !== "" &&
    new Date(form.values.start_time).getTime() <= Date.now()

  const fields = FIELDS.map((field) =>
    field.name === "pass_score"
      ? {
          ...field,
          helpText: `Out of ${totalPoints} ${totalPoints === 1 ? "point" : "points"} across all questions.`,
        }
      : field,
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Finalize {exercise.title}</DialogTitle>
          <DialogDescription>
            Set the schedule and publish. Learners in the class can sit it from the moment it
            opens. It can be unpublished back to a draft, but only before it opens and before
            anyone has submitted.
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

          {startsInThePast && (
            <p className="text-sm text-muted-foreground">
              That opening time has already passed, so learners can open it as soon as you
              finalize.
            </p>
          )}

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
              {form.submitting ? "Publishing…" : "Finalize and publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
