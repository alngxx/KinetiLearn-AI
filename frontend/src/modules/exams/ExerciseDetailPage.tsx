import { ChevronLeftIcon, SendIcon, Trash2Icon, Undo2Icon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/lib/errors"
import type { FinalizeInput } from "@/modules/exams/api"
import { formatMoment } from "@/modules/exams/dates"
import { FinalizeDialog } from "@/modules/exams/FinalizeDialog"
import { QuestionCard } from "@/modules/exams/QuestionCard"
import {
  useDeleteExercise,
  useExercise,
  useFinalizeExercise,
  useQuestionStepRunner,
  useUnpublishExercise,
} from "@/modules/exams/queries"

export function ExerciseDetailPage() {
  const { classId, exerciseId } = useParams()
  // The route cannot match without the segments, so this is only for the type.
  return (
    <DetailView
      key={exerciseId}
      classId={classId ?? ""}
      exerciseId={exerciseId ?? ""}
    />
  )
}

function DetailView({ classId, exerciseId }: { classId: string; exerciseId: string }) {
  const navigate = useNavigate()
  const [finalizeOpen, setFinalizeOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false)

  const detail = useExercise(exerciseId)
  const finalize = useFinalizeExercise()
  const remove = useDeleteExercise()
  const unpublish = useUnpublishExercise()
  const runStep = useQuestionStepRunner(exerciseId)

  const exercise = detail.data
  const questions = exercise?.questions ?? []
  const live = exercise?.is_active ?? false
  // The server refuses the same way (exams/service.py unpublish): once the
  // exam has opened, a learner could be mid-attempt with no submission row to
  // show for it yet, so unpublishing is only safe before that instant.
  const hasOpened =
    exercise !== undefined && new Date(exercise.start_time).getTime() <= Date.now()
  // finalize recomputes total_points from the questions as they stand, so this
  // is the ceiling the pass mark is really measured against — not the stored
  // column, which is stale the moment a question's points are edited.
  const totalPoints = questions.reduce((sum, question) => sum + question.points, 0)

  async function handleFinalize(body: FinalizeInput) {
    await finalize.mutateAsync({ id: exerciseId, body })
    toast.success(`${exercise?.title ?? "Exam"} is live`)
  }

  function handleDelete() {
    remove.mutate(
      { id: exerciseId },
      {
        onSuccess: () => {
          toast.success("Draft deleted")
          navigate(`/admin/classes/${classId}`, { replace: true })
        },
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not delete the draft."),
      },
    )
  }

  function handleUnpublish() {
    unpublish.mutate(
      { id: exerciseId },
      {
        onSuccess: () => toast.success(`${exercise?.title ?? "Exam"} is back in draft`),
        // A 409 names the reason — submissions exist, or it already opened —
        // so it is shown as the server wrote it rather than a generic failure.
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not unpublish the exam."),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to={`/admin/classes/${classId}`}
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" />
        Back to class
      </Link>

      <PageHeader
        eyebrow="Exam"
        title={exercise?.title ?? "Exam"}
        description={
          exercise?.description !== null && exercise?.description !== undefined
            ? exercise.description
            : "Check the questions and the answer key, then set a schedule and publish."
        }
        actions={
          exercise === undefined ? undefined : live ? (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="outline"
                disabled={unpublish.isPending || hasOpened}
                onClick={() => setConfirmingUnpublish(true)}
              >
                <Undo2Icon />
                Unpublish
              </Button>
              {hasOpened && (
                <span className="max-w-64 text-right text-xs text-muted-foreground">
                  Only an exam that has not opened yet can be unpublished. This one opened{" "}
                  {formatMoment(exercise.start_time)}.
                </span>
              )}
            </div>
          ) : (
            <>
              {/* Delete is offered on drafts only. A live exam that should never
                  have existed can be unpublished back to a draft first — before it
                  opens and before anyone has submitted — then deleted from there. */}
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2Icon />
                Delete draft
              </Button>
              <Button disabled={questions.length === 0} onClick={() => setFinalizeOpen(true)}>
                <SendIcon />
                Finalize
              </Button>
            </>
          )
        }
      />

      {detail.isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : detail.isError ? (
        <div className="rounded-xl border border-border bg-card py-10">
          <QueryErrorState
            title="Could not load this exam"
            error={detail.error}
            retrying={detail.isFetching}
            onRetry={() => void detail.refetch()}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Badge variant={live ? "success" : "outline"}>{live ? "Live" : "Draft"}</Badge>
            {live && (
              <span className="numeric text-sm text-muted-foreground">
                {formatMoment(exercise?.start_time ?? "")} –{" "}
                {formatMoment(exercise?.end_time ?? "")}
              </span>
            )}
            <span className="text-sm text-muted-foreground">
              <span className="numeric text-foreground">{questions.length}</span>{" "}
              {questions.length === 1 ? "question" : "questions"} ·{" "}
              <span className="numeric text-foreground">{totalPoints}</span>{" "}
              {totalPoints === 1 ? "point" : "points"}
              {live && (
                <>
                  {" · pass at "}
                  <span className="numeric text-foreground">{exercise?.pass_score}</span>
                  {` · ${exercise?.duration_minutes}\u00a0min`}
                </>
              )}
            </span>
          </div>

          <Coverage used={exercise?.chunks_used} total={exercise?.chunks_total} />

          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-4">
              <h2 className="label-micro">Questions</h2>
              {!live && questions.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  Open one to edit its wording, options or answer.
                </span>
              )}
            </div>

            {questions.length === 0 ? (
              <div className="rounded-xl border border-border bg-card py-12 text-center">
                <p className="text-sm font-medium text-foreground">No questions</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  An exam with no questions cannot be finalized. Delete this draft and
                  generate again.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {questions.map((question, index) => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    index={index}
                    readOnly={live}
                    runStep={runStep}
                    onSaved={(saved) => toast.success(`Question ${saved + 1} saved`)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {finalizeOpen && exercise !== undefined && (
        <FinalizeDialog
          exercise={exercise}
          totalPoints={totalPoints}
          open={finalizeOpen}
          onOpenChange={setFinalizeOpen}
          onFinalize={handleFinalize}
        />
      )}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${exercise?.title ?? "this draft"}?`}
        description="The questions and the answer key go with it. Generating a replacement costs another run over the source documents."
        confirmLabel="Delete draft"
        onConfirm={() => {
          setConfirmingDelete(false)
          handleDelete()
        }}
      />

      <ConfirmDialog
        open={confirmingUnpublish}
        onOpenChange={setConfirmingUnpublish}
        title={`Unpublish ${exercise?.title ?? "this exam"}?`}
        description="It goes back to Draft: learners can no longer see or sit it, and its questions become editable again. The schedule is kept exactly as you set it, so republishing is a re-confirm. Only possible because nobody has started it yet."
        confirmLabel="Unpublish"
        confirmVariant="destructive"
        onConfirm={() => {
          setConfirmingUnpublish(false)
          handleUnpublish()
        }}
      />
    </div>
  )
}

// Only part of a long document fits the generation context. The server reports
// how much of it was actually read, which is the difference between "the exam
// covers this material" and "the exam covers the first few pages of it".
function Coverage({ used, total }: { used?: number | null; total?: number | null }) {
  if (used === null || used === undefined || total === null || total === undefined) return null

  const partial = used < total
  return (
    <p
      className={`max-w-prose text-sm ${partial ? "text-foreground" : "text-muted-foreground"}`}
    >
      <span className="numeric">{used}</span> of <span className="numeric">{total}</span>{" "}
      source sections were read.
      {partial &&
        " The rest did not fit — questions cannot cover material the generator never saw."}
    </p>
  )
}
