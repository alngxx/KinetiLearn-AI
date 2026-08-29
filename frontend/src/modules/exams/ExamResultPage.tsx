import { ChevronLeftIcon } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { AnswerLine } from "@/components/AnswerLine"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { ResultBadge } from "@/components/ResultBadge"
import { Button } from "@/components/ui/button"
import { ExplainPanel } from "@/modules/exams/ExplainPanel"
import {
  useLearnerExam,
  useSubmission,
  type ExamSubmission,
  type LearnerExam,
} from "@/modules/exams/queries"

export function ExamResultPage() {
  const { exerciseId, submissionId } = useParams()
  return (
    <ResultView
      key={submissionId}
      exerciseId={exerciseId ?? ""}
      submissionId={submissionId ?? ""}
    />
  )
}

function ResultView({ exerciseId, submissionId }: { exerciseId: string; submissionId: string }) {
  // Two reads the page owns itself, so a reload or a shared link works: the
  // submission carries the marks, the exam carries the question text and the
  // option labels to show back what was chosen. Neither carries the answer key.
  const submission = useSubmission(submissionId)
  const exam = useLearnerExam(exerciseId)

  const failed = submission.isError ? submission : exam.isError ? exam : null
  const loading = (
    <p role="status" className="py-10 text-center text-sm text-muted-foreground">
      Loading…
    </p>
  )

  return (
    <div className="flex flex-col gap-6">
      <Link
        to={exam.data === undefined ? "/learner" : `/learner/classes/${exam.data.class_id}`}
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" />
        Back
      </Link>

      {submission.isPending || exam.isPending ? (
        loading
      ) : failed !== null ? (
        <div className="surface py-10">
          <QueryErrorState
            title="Could not load this result"
            error={failed.error}
            retrying={failed.isFetching}
            onRetry={() => {
              void submission.refetch()
              void exam.refetch()
            }}
          />
        </div>
      ) : exam.data === undefined || submission.data === undefined ? (
        // Neither pending nor failed but still without data: a refetch after an
        // error passes through here for a moment.
        loading
      ) : (
        <Result
          exam={exam.data}
          submission={submission.data}
          exerciseId={exerciseId}
          submissionId={submissionId}
        />
      )}
    </div>
  )
}

function Result({
  exam,
  submission,
  exerciseId,
  submissionId,
}: {
  exam: LearnerExam
  submission: ExamSubmission
  exerciseId: string
  submissionId: string
}) {
  const byQuestion = new Map(submission.answers.map((answer) => [answer.question_id, answer]))
  const correct = submission.answers.filter((answer) => answer.is_correct === true).length
  // Skipped counts as missed, exactly as the server counts it when deciding what
  // to explain: is_correct is null, which is not true.
  const missed = submission.answers.some((answer) => answer.is_correct !== true)

  return (
    <>
      <PageHeader
        eyebrow={`Attempt ${submission.attempt_number}`}
        title={exam.title}
        description="What you answered, and how it was marked."
      />

      <div className="flex flex-wrap items-center justify-between gap-4 surface p-5">
        <div className="flex flex-col gap-1">
          <p className="flex items-baseline gap-2">
            <span className="numeric text-2xl font-semibold text-foreground">
              {submission.score ?? 0} / {exam.total_points}
            </span>
            <span className="text-sm text-muted-foreground">
              points · pass mark {exam.pass_score}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="numeric text-foreground">
              {correct} of {exam.questions.length}
            </span>{" "}
            questions correct
            {submission.is_late && " · sent after the exam closed"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ResultBadge isPassed={submission.is_passed} />
          <Button variant="outline" asChild>
            <Link to={`/learner/exams/${exerciseId}/take`}>Try again</Link>
          </Button>
        </div>
      </div>

      {/* Only the learner's own answer is marked. The correct option and the
          explanation are in no learner-facing response — the explanation panel
          below is the only route to them, and only for what was missed. */}
      <ul className="flex flex-col gap-3">
        {exam.questions.map((question, index) => {
          const answer = byQuestion.get(question.id)
          const chosen = question.options.find(
            (option) => option.id === answer?.selected_option_id,
          )
          return (
            <li
              key={question.id}
              className="flex flex-col gap-2 surface p-5"
            >
              <p className="flex gap-2 text-sm font-medium break-words text-foreground">
                <span className="label-micro shrink-0 pt-0.5">{index + 1}</span>
                {question.question_text}
              </p>
              <AnswerLine
                isCorrect={answer?.is_correct ?? null}
                text={
                  chosen === undefined
                    ? "You skipped this one"
                    : `${chosen.option_label}. ${chosen.option_text}`
                }
              />
            </li>
          )
        })}
      </ul>

      {/* Nothing to explain when every answer was right, and the server refuses
          that case with a 400 rather than returning an empty answer. */}
      {missed && <ExplainPanel submissionId={submissionId} />}
    </>
  )
}
