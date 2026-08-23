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
import type { Exercise, SubmissionDetail } from "@/modules/submissions/api"

const SCORE_FIELD: FormField = {
  name: "score",
  label: "Score",
  kind: "number",
  required: true,
}

export function ScoreOverrideDialog({
  submission,
  exercise,
  open,
  onOpenChange,
  onSave,
}: {
  submission: SubmissionDetail
  exercise: Exercise
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (score: number) => Promise<void>
}) {
  const field: FormField = {
    ...SCORE_FIELD,
    helpText: `0–${exercise.total_points} points.`,
  }

  const form = useEntityForm({
    fields: [field],
    initial: { score: String(submission.score ?? 0) },
    // score >= 0 and "whole number" are already caught by the shared number
    // validation in validateFields; the upper bound is specific to this
    // exercise, so it is checked here — mirroring the 400
    // update_score raises when score exceeds exercise.total_points.
    validate: (values): Record<string, string> => {
      const raw = Number(values.score)
      if (Number.isInteger(raw) && raw > exercise.total_points) {
        return { score: `Cannot exceed ${exercise.total_points} points.` }
      }
      return {}
    },
    onSubmit: async (values) => {
      await onSave(Number(values.score))
      onOpenChange(false)
    },
  })

  const raw = Number(form.values.score)
  const valid = Number.isInteger(raw) && raw >= 0 && raw <= exercise.total_points
  const willPass = raw >= exercise.pass_score
  const wasPassed = submission.is_passed

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Override score</DialogTitle>
          <DialogDescription>
            Recalculates the result from the pass mark of {exercise.pass_score}. Nothing else
            about the submission changes.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void form.submit()
          }}
        >
          <FieldRow
            field={field}
            value={form.values.score ?? ""}
            error={form.errors.score}
            onChange={(value) => form.setValue("score", value)}
          />

          {/* Derived from the same pass_score the server recomputes against, so
              this is a forecast of the real outcome rather than a guess — the
              badge on the page still re-renders from what the server returns. */}
          {valid && (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              <span className="numeric text-foreground">{raw}</span> of{" "}
              <span className="numeric text-foreground">{exercise.total_points}</span> —{" "}
              {willPass ? "passes" : "does not pass"} the{" "}
              <span className="numeric">{exercise.pass_score}</span>-point mark.
              {wasPassed !== null && wasPassed !== willPass && (
                <>
                  {" "}
                  This changes the result from {wasPassed ? "passed" : "failed"} to{" "}
                  {willPass ? "passed" : "failed"}.
                </>
              )}
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
              {form.submitting ? "Saving…" : "Save override"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
