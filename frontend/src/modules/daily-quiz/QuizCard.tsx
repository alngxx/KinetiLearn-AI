import { CalendarClockIcon, CheckIcon } from "lucide-react"
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
        "flex flex-wrap items-center gap-5 rounded-xl border px-6 py-[22px] shadow-raised",
        // Brass marks "the one that counts" throughout the app — the correct
        // option in a reviewed exam, the answer currently selected while taking
        // a quiz. An unanswered quiz is the single thing on this page asking to
        // be acted on, so it borrows that exact treatment. An answered one falls
        // back to the neutral card and says so with the green badge instead, so
        // the two states differ in colour, not just in wording.
        //
        // The slow glow rides the same `available` flag: it is the affordance,
        // not decoration, and it stops the moment there is nothing to do. It is
        // also the only moving thing on the page, so it stays the one that
        // counts. Reduced motion drops it to the static raised shadow.
        available
          ? "quiz-breathe border-[color-mix(in_oklab,var(--ring)_34%,var(--border))] bg-accent/40"
          : "border-border bg-card",
        className,
      )}
    >
      {/* The chip is what makes the row read as an appointment rather than a
          list item. It takes the accent while the quiz is open and falls back to
          the neutral muted treatment once there is nothing to do. */}
      <span
        aria-hidden="true"
        className={cn(
          "flex size-[42px] shrink-0 items-center justify-center rounded-[10px]",
          available
            ? "bg-[color-mix(in_oklab,var(--ring)_18%,transparent)] text-ring"
            : "bg-muted text-muted-foreground",
        )}
      >
        <CalendarClockIcon className="size-[19px]" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">
            {formatDay(quiz.quiz_date)}
          </h3>
          {quiz.already_submitted && (
            <Badge variant="success">
              <CheckIcon aria-hidden="true" />
              Answered
            </Badge>
          )}
        </div>
        <p className="numeric text-[11.5px] tracking-[0.02em] text-muted-foreground">
          {count} {count === 1 ? "question" : "questions"}
          {" · "}
          <time dateTime={quiz.expires_at}>{formatRemaining(quiz.expires_at)}</time>
        </p>
      </div>

      {quiz.already_submitted ? (
        <p className="text-sm text-muted-foreground">Nothing left to do here today.</p>
      ) : (
        <Button
          asChild
          className="shrink-0 transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_8px_22px_-12px_var(--glow)]"
        >
          <Link to={`/learner/quiz/${quiz.id}`}>Start quiz</Link>
        </Button>
      )}
    </article>
  )
}
