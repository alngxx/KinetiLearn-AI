import { CheckIcon, ChevronLeftIcon, PencilIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { toast } from "sonner"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatMoment } from "@/modules/submissions/dates"
import { ScoreOverrideDialog } from "@/modules/submissions/ScoreOverrideDialog"
import { useExercise, useOverrideScore, useSubmission, useUser } from "@/modules/submissions/queries"

export function SubmissionDetailPage() {
  const { submissionId } = useParams()
  // The route cannot match without the segment, so this is only for the type.
  return <DetailView key={submissionId} submissionId={submissionId ?? ""} />
}

function DetailView({ submissionId }: { submissionId: string }) {
  const [overrideOpen, setOverrideOpen] = useState(false)

  const detail = useSubmission(submissionId)
  const exercise = useExercise(detail.data?.exercise_id)
  const learner = useUser(detail.data?.user_id)
  const override = useOverrideScore()

  async function handleOverride(score: number) {
    await override.mutateAsync({ id: submissionId, score })
    toast.success("Score updated")
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin/submissions"
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" />
        Back to submissions
      </Link>

      {detail.isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : detail.isError ? (
        <QueryErrorState
          title="Could not load this submission"
          error={detail.error}
          retrying={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      ) : (
        <>
          <PageHeader
            eyebrow="Submission"
            title={exercise.data?.title ?? "Exam"}
            description={`${learner.data?.full_name ?? "Learner"} · Attempt ${detail.data.attempt_number}`}
            actions={
              exercise.data === undefined ? undefined : (
                <Button variant="outline" onClick={() => setOverrideOpen(true)}>
                  <PencilIcon />
                  Override score
                </Button>
              )
            }
          />

          <div className="flex flex-wrap gap-6 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-1">
              <span className="label-micro">Score</span>
              <span className="numeric text-lg font-semibold text-foreground">
                {detail.data.score ?? "—"}
                {exercise.data !== undefined && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    / {exercise.data.total_points}
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="label-micro">Result</span>
              {detail.data.is_passed === null ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                <Badge variant={detail.data.is_passed ? "success" : "destructive"}>
                  {detail.data.is_passed ? "Passed" : "Failed"}
                </Badge>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="label-micro">Submitted</span>
              <span className="numeric text-sm text-muted-foreground">
                {detail.data.submitted_at === null ? "—" : formatMoment(detail.data.submitted_at)}
                {detail.data.is_late && " · Late"}
              </span>
            </div>
          </div>

          {exercise.isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading questions…</p>
          ) : exercise.isError ? (
            <QueryErrorState
              title="Could not load the exam's questions"
              error={exercise.error}
              retrying={exercise.isFetching}
              onRetry={() => void exercise.refetch()}
            />
          ) : (
            <ol className="flex flex-col gap-3">
              {[...exercise.data.questions]
                .sort((a, b) => a.order_index - b.order_index)
                .map((question, index) => {
                  const answer = detail.data.answers.find((a) => a.question_id === question.id)
                  return (
                    <li
                      key={question.id}
                      className="rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm font-medium text-foreground">
                          <span className="numeric text-muted-foreground">{index + 1}.</span>{" "}
                          {question.question_text}
                        </p>
                        <span className="numeric shrink-0 text-xs text-muted-foreground">
                          {answer?.points_earned ?? 0} / {question.points}
                        </span>
                      </div>

                      <ul className="mt-3 flex flex-col gap-1.5">
                        {question.options.map((option) => {
                          const wasSelected = answer?.selected_option_id === option.id
                          return (
                            <li
                              key={option.id}
                              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                                option.is_correct
                                  ? "bg-success/10 text-success"
                                  : wasSelected
                                    ? "bg-destructive/10 text-destructive"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {option.is_correct ? (
                                <CheckIcon aria-hidden="true" className="size-4 shrink-0" />
                              ) : wasSelected ? (
                                <XIcon aria-hidden="true" className="size-4 shrink-0" />
                              ) : (
                                <span aria-hidden="true" className="size-4 shrink-0" />
                              )}
                              <span>{option.option_text}</span>
                              {wasSelected && (
                                <span className="ml-auto text-xs">Selected</span>
                              )}
                            </li>
                          )
                        })}
                        {answer?.selected_option_id === null && (
                          <li className="px-2.5 text-xs text-muted-foreground">Skipped</li>
                        )}
                      </ul>
                    </li>
                  )
                })}
            </ol>
          )}

          {overrideOpen && exercise.data !== undefined && (
            <ScoreOverrideDialog
              submission={detail.data}
              exercise={exercise.data}
              open={overrideOpen}
              onOpenChange={setOverrideOpen}
              onSave={handleOverride}
            />
          )}
        </>
      )}
    </div>
  )
}
