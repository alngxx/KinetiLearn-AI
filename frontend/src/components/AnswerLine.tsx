import { CheckIcon, MinusIcon, XIcon } from "lucide-react"

// A learner's own answer, marked. Three states rather than two: is_correct is
// null for a question that was skipped, which is neither right nor wrong.
// Shared by the daily quiz result and the exam result — the correct option is
// in no learner-facing response, so this is the whole of what can be shown.
export function AnswerLine({ isCorrect, text }: { isCorrect: boolean | null; text: string }) {
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
