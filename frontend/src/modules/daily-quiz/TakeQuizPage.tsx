import { CheckIcon, ChevronLeftIcon, MinusIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/lib/errors"
import type { QuizSubmission } from "@/modules/daily-quiz/api"
import { useSubmitQuiz, useTodayQuizzes, type QuizQuestion } from "@/modules/daily-quiz/queries"
import { formatDay } from "@/modules/learner-home/dates"

// What the page keeps after a successful submit. The questions are captured
// alongside the result because submitting invalidates ["quiz","today"], and the
// refetched quiz comes back already_submitted — the result must not depend on
// still finding it in that list.
type Result = {
  submission: QuizSubmission
  questions: QuizQuestion[]
}

export function TakeQuizPage() {
  const { quizId } = useParams()
  return <TakeView key={quizId} quizId={quizId ?? ""} />
}

function TakeView({ quizId }: { quizId: string }) {
  // The page owns the query rather than reading the cache directly: on a reload
  // or a pasted link there is no cache, and getQueryData would report a live
  // quiz as missing. Sharing the key means arriving from home still hits cache.
  const quizzes = useTodayQuizzes()
  const submit = useSubmitQuiz()

  const [selected, setSelected] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const quiz = quizzes.data?.find((row) => row.id === quizId)
  const questions = quiz?.questions ?? []
  const unanswered = questions.filter((question) => !(question.id in selected)).length

  function send() {
    if (quiz === undefined) return
    // Only the answered ones are sent. The server writes a row for every
    // question either way, recording the rest as answered-with-nothing.
    const answers = questions
      .filter((question) => question.id in selected)
      .map((question) => ({
        daily_quiz_question_id: question.id,
        selected_option_id: selected[question.id],
      }))

    submit.mutate(
      { daily_quiz_id: quiz.id, answers },
      { onSuccess: (data) => setResult({ submission: data, questions }) },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/learner"
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" />
        Home
      </Link>

      <PageHeader
        eyebrow="Daily quiz"
        title={quiz === undefined ? "Daily quiz" : formatDay(quiz.quiz_date)}
        description={
          result === null && quiz !== undefined && !quiz.already_submitted
            ? "You get one attempt. Answers cannot be changed once sent."
            : undefined
        }
      />

      {/* The result outranks everything below it: submitting invalidates the
          list, so the quiz reappears as already_submitted moments later. */}
      {result !== null ? (
        <ResultView result={result} />
      ) : quizzes.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : quizzes.isError ? (
        <div className="rounded-xl border border-border bg-card py-10">
          <QueryErrorState
            title="Could not load this quiz"
            error={quizzes.error}
            retrying={quizzes.isFetching}
            onRetry={() => void quizzes.refetch()}
          />
        </div>
      ) : quiz === undefined ? (
        <Fallback
          title="This quiz isn't available"
          body="It may have expired, or it was never assigned to you. Anything still open is on your home page."
        />
      ) : quiz.already_submitted ? (
        <Fallback
          title="You've already answered this quiz"
          body="There is one attempt per quiz, and yours is in. Your next one will appear on your home page when it is sent."
        />
      ) : (
        <>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (unanswered > 0) setConfirming(true)
              else send()
            }}
          >
            {questions.map((question, index) => (
              <QuestionField
                key={question.id}
                question={question}
                index={index}
                selected={selected[question.id]}
                disabled={submit.isPending}
                onSelect={(optionId) =>
                  setSelected((current) => ({ ...current, [question.id]: optionId }))
                }
              />
            ))}

            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending ? "Sending…" : "Submit answers"}
              </Button>
              <p className="text-sm text-muted-foreground">
                <span className="numeric text-foreground">
                  {questions.length - unanswered} of {questions.length}
                </span>{" "}
                answered
              </p>
            </div>

            {submit.isError && (
              <p role="alert" className="text-sm text-destructive">
                {isApiError(submit.error)
                  ? submit.error.message
                  : "Could not send your answers. Please try again."}
              </p>
            )}
          </form>

          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={
              unanswered === 1
                ? "Send with 1 question unanswered?"
                : `Send with ${unanswered} questions unanswered?`
            }
            description="Unanswered questions score nothing, and there is only one attempt — you cannot come back to them."
            confirmLabel="Send anyway"
            onConfirm={() => {
              setConfirming(false)
              send()
            }}
          />
        </>
      )}
    </div>
  )
}

function QuestionField({
  question,
  index,
  selected,
  disabled,
  onSelect,
}: {
  question: QuizQuestion
  index: number
  selected: string | undefined
  disabled: boolean
  onSelect: (optionId: string) => void
}) {
  // Block, not flex: a legend is laid out specially and does not behave as a
  // flex item consistently across browsers.
  return (
    <fieldset className="rounded-xl border border-border bg-card p-5">
      <legend className="mb-3 flex gap-2 text-sm font-medium break-words text-foreground">
        <span className="label-micro shrink-0 pt-0.5">{index + 1}</span>
        {question.question_text}
      </legend>
      <div className="flex flex-col gap-1.5">
        {question.options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-sm transition-colors hover:bg-muted/60 has-checked:border-ring/40 has-checked:bg-accent/40 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <input
              type="radio"
              name={question.id}
              value={option.id}
              checked={selected === option.id}
              disabled={disabled}
              onChange={() => onSelect(option.id)}
              className="mt-0.5 size-4 shrink-0 accent-ring outline-none"
            />
            <span className="label-micro shrink-0 pt-0.5">{option.option_label}</span>
            <span className="min-w-0 break-words text-foreground">{option.option_text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ResultView({ result }: { result: Result }) {
  const { submission, questions } = result
  const byQuestion = new Map(submission.answers.map((answer) => [answer.daily_quiz_question_id, answer]))
  const correct = submission.answers.filter((answer) => answer.is_correct === true).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-1">
          <p className="flex items-baseline gap-2">
            <span className="numeric text-2xl font-semibold text-foreground">
              {correct} of {questions.length}
            </span>
            <span className="text-sm text-muted-foreground">correct</span>
          </p>
          {/* The score is raw points. Question points are not in the learner
              payload, so there is no maximum to show it against. */}
          <p className="text-sm text-muted-foreground">
            <span className="numeric text-foreground">{submission.score}</span>{" "}
            {submission.score === 1 ? "point" : "points"} earned
            {submission.is_late && " · answered after it expired"}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/learner">Back to home</Link>
        </Button>
      </div>

      {/* Only the learner's own answer is marked. The correct option and the
          explanation are deliberately not in any learner-facing response. */}
      <ul className="flex flex-col gap-3">
        {questions.map((question, index) => {
          const answer = byQuestion.get(question.id)
          const chosen = question.options.find((option) => option.id === answer?.selected_option_id)
          return (
            <li
              key={question.id}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5"
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
    </div>
  )
}

function AnswerLine({ isCorrect, text }: { isCorrect: boolean | null; text: string }) {
  const Icon = isCorrect === null ? MinusIcon : isCorrect ? CheckIcon : XIcon
  const tone =
    isCorrect === null ? "text-muted-foreground" : isCorrect ? "text-success" : "text-destructive"
  const label = isCorrect === null ? "Skipped" : isCorrect ? "Correct" : "Incorrect"

  return (
    <p className={`flex items-start gap-2 text-sm ${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 break-words">{text}</span>
    </p>
  )
}

function Fallback({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{body}</p>
      <Button variant="outline" className="mt-4" asChild>
        <Link to="/learner">Back to home</Link>
      </Button>
    </div>
  )
}
