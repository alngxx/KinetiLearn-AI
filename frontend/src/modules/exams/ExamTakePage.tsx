import { ChevronLeftIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/lib/errors"
import type { LearnerQuestion } from "@/modules/exams/api"
import { useLearnerExam, useSubmitExam } from "@/modules/exams/queries"
import { deadlineFor, formatCountdown } from "@/modules/exams/timer"
import { formatMoment } from "@/modules/learner-home/dates"

// Warn at five minutes. Only the thresholds are announced; the countdown itself
// is never a live region, because a screen reader reading a new number every
// second is unusable.
const WARN_AT_MS = 5 * 60_000

export function ExamTakePage() {
  const { exerciseId } = useParams()
  // The route cannot match without the segment, so this is only for the type.
  return <TakeView key={exerciseId} exerciseId={exerciseId ?? ""} />
}

function TakeView({ exerciseId }: { exerciseId: string }) {
  // The page owns the query rather than reading the cache: a reload or a pasted
  // link arrives with nothing cached, and this is the only read that carries the
  // questions. Coming from the class page still hits the cache on the same key.
  const exam = useLearnerExam(exerciseId)
  const submit = useSubmitExam()
  const navigate = useNavigate()

  const [selected, setSelected] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)

  const questions = exam.data?.questions ?? []
  const unanswered = questions.filter((question) => !(question.id in selected)).length

  function send() {
    if (exam.data === undefined) return
    // Only the answered ones are sent. The server writes a row for every
    // question either way, recording the rest as answered-with-nothing.
    const answers = questions
      .filter((question) => question.id in selected)
      .map((question) => ({
        question_id: question.id,
        selected_option_id: selected[question.id],
      }))
    submit.mutate(
      { exercise_id: exam.data.id, answers },
      {
        onSuccess: (submission) =>
          // replace: Back from the result should return to the class, not to a
          // take page whose answers have already been sent.
          navigate(`/learner/exams/${exerciseId}/result/${submission.id}`, { replace: true }),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to={exam.data === undefined ? "/learner" : `/learner/classes/${exam.data.class_id}`}
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/75"
      >
        <ChevronLeftIcon className="size-4" />
        Back
      </Link>

      {exam.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : exam.isError ? (
        // The server words this one itself — not finalized, not started yet, not
        // a member — so the page reports its reason rather than guessing one.
        <div className="surface py-10">
          <QueryErrorState
            title="Could not open this exam"
            error={exam.error}
            retrying={exam.isFetching}
            onRetry={() => void exam.refetch()}
          />
        </div>
      ) : (
        <>
          <PageHeader
            eyebrow="Exam"
            title={exam.data.title}
            description={exam.data.description ?? undefined}
          />

          <Timer
            durationMinutes={exam.data.duration_minutes}
            endTime={exam.data.end_time}
            passScore={exam.data.pass_score}
            totalPoints={exam.data.total_points}
          />

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (unanswered > 0) setConfirming(true)
              else send()
            }}
          >
            <ol className="flex flex-col gap-3">
              {questions.map((question, index) => (
                <li key={question.id}>
                  <QuestionField
                    question={question}
                    index={index}
                    selected={selected[question.id]}
                    onSelect={(optionId) =>
                      setSelected((current) => ({ ...current, [question.id]: optionId }))
                    }
                  />
                </li>
              ))}
            </ol>

            {submit.isError && (
              <p role="alert" className="text-sm text-destructive">
                {isApiError(submit.error)
                  ? submit.error.message
                  : "Could not send your answers. Please try again."}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={submit.isPending}>
                {submit.isPending ? "Sending…" : "Send answers"}
              </Button>
              <p className="text-sm text-muted-foreground">
                {unanswered === 0
                  ? "Every question answered."
                  : unanswered === 1
                    ? "1 question still unanswered."
                    : `${unanswered} questions still unanswered.`}
              </p>
            </div>
          </form>

          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={
              unanswered === 1
                ? "Send with 1 question unanswered?"
                : `Send with ${unanswered} questions unanswered?`
            }
            // Unlike the daily quiz, retries are unlimited here, so this must not
            // say the attempt cannot be repeated. It cannot be edited, though.
            description="Unanswered questions score nothing. You cannot change this attempt once it is sent, but you can take the exam again."
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

function Timer({
  durationMinutes,
  endTime,
  passScore,
  totalPoints,
}: {
  durationMinutes: number
  endTime: string
  passScore: number
  totalPoints: number
}) {
  // Lazy initializer, so Date.now() runs exactly once for this mount. useRef
  // would re-evaluate the argument on every render even though it keeps the
  // first value — same result here, but for the wrong reason.
  const [mountedAt] = useState(() => Date.now())
  const deadline = useMemo(
    () => deadlineFor(mountedAt, durationMinutes, endTime),
    [mountedAt, durationMinutes, endTime],
  )
  // Which of the two limits is actually binding — the personal window or the
  // moment the exam closes for everyone. They mean different things, so the
  // label says which one is running down.
  const closesFirst = new Date(endTime).getTime() <= mountedAt + durationMinutes * 60_000

  const [now, setNow] = useState(mountedAt)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const remaining = deadline - now
  const expired = remaining <= 0
  const warning = !expired && remaining <= WARN_AT_MS
  const tone = expired
    ? "border-destructive/40 text-destructive"
    : warning
      ? "border-ring/50 text-accent-foreground"
      : "border-border text-foreground"

  return (
    <div className={`flex flex-col gap-2 rounded-xl border bg-card p-5 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        {/* role="timer" rather than aria-hidden: the value has to be readable
            on demand, and a hidden one leaves a screen reader with no way to
            ask how long is left. A timer defaults to aria-live off, so it is
            read when navigated to and never announces itself every second. The
            two thresholds below are the only things that speak on their own. */}
        <p role="timer" className="flex items-baseline gap-2">
          {expired ? (
            <span className="text-2xl font-semibold tracking-tight">Time is up</span>
          ) : (
            <>
              <span className="numeric text-2xl font-semibold">
                {formatCountdown(remaining)}
              </span>
              <span className="text-sm text-muted-foreground">
                {closesFirst ? "until this exam closes" : `left of ${durationMinutes} minutes`}
              </span>
            </>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          Pass mark{" "}
          <span className="numeric text-foreground">
            {passScore} / {totalPoints}
          </span>
        </p>
      </div>

      <p role="status" className="text-sm">
        {expired ? (
          <span className="text-destructive">
            Time is up. You can still send your answers — they will be recorded as late.
          </span>
        ) : warning ? (
          <span className="text-accent-foreground">Under five minutes left.</span>
        ) : (
          // Deliberately empty the rest of the time: a live region that carried
          // the countdown would announce a new number every second.
          ""
        )}
      </p>

      {/* Said plainly because it is true: no attempt start is stored anywhere on
          the server, so this clock belongs to this page only. */}
      <p className="text-xs text-muted-foreground">
        The timer starts when you open this page and restarts if you reload it. This exam closes on{" "}
        <time dateTime={endTime}>{formatMoment(endTime)}</time>; answers sent after that are
        recorded as late but still scored.
      </p>
    </div>
  )
}

function QuestionField({
  question,
  index,
  selected,
  onSelect,
}: {
  question: LearnerQuestion
  index: number
  selected: string | undefined
  onSelect: (optionId: string) => void
}) {
  // Block, not flex: a legend is laid out specially and does not behave as a
  // flex item consistently across browsers. Same reason the daily quiz keeps its
  // fieldset a block and spaces the legend with a margin.
  return (
    <fieldset className="surface p-5">
      <legend className="mb-3 flex gap-2 text-sm font-medium break-words text-foreground">
        <span className="label-micro shrink-0 pt-0.5">{index + 1}</span>
        <span className="min-w-0">{question.question_text}</span>
        <span className="numeric shrink-0 pt-0.5 text-xs text-muted-foreground">
          {question.points === 1 ? "1 pt" : `${question.points} pts`}
        </span>
      </legend>

      <div className="flex flex-col gap-2">
        {question.options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors has-checked:border-ring/40 has-checked:bg-accent/40 has-focus-visible:ring-3 has-focus-visible:ring-ring/75 hover:bg-accent/20"
          >
            <input
              type="radio"
              name={question.id}
              value={option.id}
              checked={selected === option.id}
              onChange={() => onSelect(option.id)}
              className="accent-ring mt-0.5 size-4 shrink-0 outline-none"
            />
            <span className="min-w-0 break-words text-foreground">
              <span className="label-micro mr-1.5">{option.option_label}</span>
              {option.option_text}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
