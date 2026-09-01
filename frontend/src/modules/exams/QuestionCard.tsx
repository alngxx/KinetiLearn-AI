import { CheckIcon, ChevronDownIcon, MinusIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { isApiError } from "@/lib/errors"
import {
  buildSaveSteps,
  draftFromQuestion,
  type Question,
  type QuestionDraft,
  type SaveStep,
} from "@/modules/exams/api"

type StepState = {
  label: string
  status: "pending" | "saved" | "failed"
  error?: string
}

function messageFor(err: unknown): string {
  return isApiError(err) ? err.message : "Something went wrong. Please try again."
}

export function QuestionCard({
  question,
  index,
  readOnly,
  runStep,
  onSaved,
}: {
  question: Question
  index: number
  readOnly: boolean
  runStep: (questionId: string, step: SaveStep) => Promise<Question>
  onSaved: (index: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<QuestionDraft>(() => draftFromQuestion(question))
  const [plan, setPlan] = useState<SaveStep[] | null>(null)
  const [outcomes, setOutcomes] = useState<StepState[]>([])
  const [saving, setSaving] = useState(false)

  const options = [...question.options].sort((a, b) =>
    a.option_label.localeCompare(b.option_label),
  )
  const correct = options.find((option) => option.is_correct)

  // Any edit invalidates a half-finished attempt: the next save rebuilds the
  // diff against the baseline the server actually has, so already-saved steps
  // drop out of it on their own.
  function edit(change: Partial<QuestionDraft>) {
    setPlan(null)
    setOutcomes([])
    setDraft((current) => ({ ...current, ...change }))
  }

  function reset() {
    setDraft(draftFromQuestion(question))
    setPlan(null)
    setOutcomes([])
    setOpen(false)
  }

  // Steps run in order and stop at the first failure: the answer key must never
  // land on option text that failed to save, and a dropped connection would fail
  // every remaining call identically anyway.
  async function run(steps: SaveStep[], current: StepState[]) {
    setSaving(true)
    const next = current.map((outcome) => ({ ...outcome }))
    let failed = false

    for (let i = 0; i < steps.length; i++) {
      if (next[i].status === "saved") continue
      try {
        await runStep(question.id, steps[i])
        next[i] = { ...next[i], status: "saved", error: undefined }
      } catch (err) {
        next[i] = { ...next[i], status: "failed", error: messageFor(err) }
        failed = true
        break
      }
    }

    setSaving(false)
    if (failed) {
      setPlan(steps)
      setOutcomes(next)
      return
    }
    setPlan(null)
    setOutcomes([])
    setOpen(false)
    onSaved(index)
  }

  function save() {
    if (plan !== null) {
      void run(plan, outcomes)
      return
    }
    const steps = buildSaveSteps(question, draft)
    if (steps.length === 0) {
      setOpen(false)
      return
    }
    void run(
      steps,
      steps.map((step) => ({ label: step.label, status: "pending" as const })),
    )
  }

  const partly = outcomes.some((outcome) => outcome.status === "saved")
  const failure = outcomes.find((outcome) => outcome.status === "failed")

  return (
    <li className="surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => (open ? reset() : setOpen(true))}
        className="flex w-full items-start gap-3 rounded-xl p-4 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/75"
      >
        <span className="numeric mt-0.5 shrink-0 text-sm text-muted-foreground">
          {index + 1}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm break-words text-foreground">{question.question_text}</span>
          <span className="numeric text-xs text-muted-foreground">
            {question.points} {question.points === 1 ? "point" : "points"}
            {correct !== undefined && ` · answer ${correct.option_label}`}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-4">
          {readOnly ? (
            <ReadOnlyBody question={question} options={options} />
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`text-${question.id}`} className="text-sm font-medium">
                  Question
                </Label>
                <Textarea
                  id={`text-${question.id}`}
                  value={draft.question_text}
                  onChange={(event) => edit({ question_text: event.target.value })}
                />
              </div>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-sm font-medium">Options</legend>
                <p className="text-xs text-muted-foreground">
                  Pick the one correct answer. Choosing a new one clears the old.
                </p>
                <div className="flex flex-col gap-2">
                  {options.map((option) => (
                    <div key={option.id} className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name={`correct-${question.id}`}
                        id={`option-${option.id}`}
                        checked={draft.correctOptionId === option.id}
                        onChange={() => edit({ correctOptionId: option.id })}
                        className="size-4 shrink-0 accent-[var(--ring)] outline-none focus-visible:ring-3 focus-visible:ring-ring/75"
                      />
                      <Label
                        htmlFor={`option-${option.id}`}
                        className="numeric w-4 shrink-0 text-sm text-muted-foreground"
                      >
                        {option.option_label}
                      </Label>
                      <Input
                        aria-label={`Option ${option.option_label} text`}
                        autoComplete="off"
                        value={draft.optionText[option.id] ?? ""}
                        onChange={(event) =>
                          edit({
                            optionText: { ...draft.optionText, [option.id]: event.target.value },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`why-${question.id}`} className="text-sm font-medium">
                  Explanation
                </Label>
                <Textarea
                  id={`why-${question.id}`}
                  value={draft.explanation}
                  onChange={(event) => edit({ explanation: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Shown to learners after they submit. Leave it blank to remove it.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`points-${question.id}`} className="text-sm font-medium">
                  Points
                </Label>
                <Input
                  id={`points-${question.id}`}
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  className="numeric w-24"
                  value={draft.points}
                  onChange={(event) => edit({ points: event.target.value })}
                />
              </div>

              {/* A save is several separate writes with no transaction behind
                  them, so a failure halfway has to say which of them landed
                  rather than reporting one blanket error. */}
              {failure !== undefined &&
                (partly ? (
                  <div
                    role="alert"
                    className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3"
                  >
                    <p className="text-sm font-medium text-foreground">Partly saved</p>
                    <ul className="flex flex-col gap-1">
                      {outcomes.map((outcome) => (
                        <li key={outcome.label} className="flex items-start gap-2 text-sm">
                          <StepIcon status={outcome.status} />
                          <span className="min-w-0 break-words">
                            <span className="text-foreground">{outcome.label}</span>
                            <span className="text-muted-foreground">
                              {outcome.status === "saved"
                                ? " — saved"
                                : outcome.status === "failed"
                                  ? ` — ${outcome.error}`
                                  : " — not attempted"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p role="alert" className="text-sm text-destructive">
                    {failure.error}
                  </p>
                ))}

              <div className="flex items-center gap-2">
                <Button type="button" disabled={saving} onClick={save}>
                  {saving
                    ? "Saving…"
                    : plan !== null
                      ? "Retry unsaved changes"
                      : "Save question"}
                </Button>
                <Button type="button" variant="outline" disabled={saving} onClick={reset}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function StepIcon({ status }: { status: StepState["status"] }) {
  if (status === "saved") {
    return <CheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
  }
  if (status === "failed") {
    return <XIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-destructive" />
  }
  return (
    <MinusIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
  )
}

// Once an exam is live, learners may already have answered it. The API would
// still accept an edit, but rewriting the answer key underneath a scored
// submission is not something to offer behind an innocuous save button.
function ReadOnlyBody({
  question,
  options,
}: {
  question: Question
  options: Question["options"]
}) {
  return (
    <>
      <ul className="flex flex-col gap-1.5">
        {options.map((option) => (
          <li
            key={option.id}
            className={`flex items-baseline gap-2.5 border-l-2 py-0.5 pl-2.5 ${option.is_correct ? "border-ring" : "border-transparent"}`}
          >
            <span className="numeric w-4 shrink-0 text-sm text-muted-foreground">
              {option.option_label}
            </span>
            <span className="min-w-0 text-sm break-words text-foreground">
              {option.option_text}
            </span>
            {option.is_correct && <span className="label-micro ml-auto text-ring">Correct</span>}
          </li>
        ))}
      </ul>

      {question.explanation !== null && question.explanation !== "" && (
        <p className="max-w-prose text-sm text-muted-foreground">{question.explanation}</p>
      )}

      <p className="text-xs text-muted-foreground">
        This exam is live, so its questions are locked. Learners may already have answered
        them.
      </p>
    </>
  )
}
