import { ArrowRightIcon, CheckIcon } from "lucide-react"
import type { CSSProperties } from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TodayQuiz } from "@/modules/daily-quiz/queries"
import { formatDay, formatRemaining } from "@/modules/learner-home/dates"

export function QuizCard({
  quiz,
  className,
  style,
}: {
  quiz: TodayQuiz
  className?: string
  style?: CSSProperties
}) {
  const count = quiz.questions.length
  // The API only returns quizzes that have not expired, so anything unanswered
  // is still open.
  const available = !quiz.already_submitted

  return (
    <article
      data-available={available || undefined}
      style={style}
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 shadow-raised",
        // Brass marks "the one that counts" throughout the app — the correct
        // option in a reviewed exam, the answer currently selected while taking
        // a quiz. An unanswered quiz is the single thing on this page asking to
        // be acted on, so it borrows that exact treatment. An answered one falls
        // back to the neutral card and says so with the green badge instead, so
        // the two states differ in colour, not just in wording.
        available ? "border-ring/40 bg-accent/40" : "border-border bg-card",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-foreground">{formatDay(quiz.quiz_date)}</h3>
          {quiz.already_submitted && (
            <Badge variant="success">
              <CheckIcon aria-hidden="true" />
              Answered
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="numeric text-foreground">{count}</span>{" "}
          {count === 1 ? "question" : "questions"}
          {" · "}
          <time dateTime={quiz.expires_at}>{formatRemaining(quiz.expires_at)}</time>
        </p>
      </div>

      {quiz.already_submitted ? (
        <p className="text-sm text-muted-foreground">Nothing left to do here today.</p>
      ) : (
        <Button asChild>
          <Link to={`/learner/quiz/${quiz.id}`}>
            Start quiz
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      )}
    </article>
  )
}
