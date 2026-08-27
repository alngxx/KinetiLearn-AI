import { ArrowRightIcon, CheckIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { TodayQuiz } from "@/modules/daily-quiz/queries"
import { formatDay, formatRemaining } from "@/modules/learner-home/dates"

export function QuizCard({ quiz }: { quiz: TodayQuiz }) {
  const count = quiz.questions.length

  return (
    <article className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1.5">
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
