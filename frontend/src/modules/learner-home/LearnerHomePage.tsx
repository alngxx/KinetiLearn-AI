import { ChevronRightIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { QuizCard } from "@/modules/daily-quiz/QuizCard"
import { useTodayQuizzes } from "@/modules/daily-quiz/queries"
import { formatRange } from "@/modules/learner-home/dates"
import { useMyClasses, type MyClass } from "@/modules/learner-home/queries"

export function LearnerHomePage() {
  const quizzes = useTodayQuizzes()
  const classes = useMyClasses()

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Home"
        title="Your training"
        description="Today's quiz and the classes you are enrolled in."
      />

      <section className="flex flex-col gap-3">
        <h2 className="label-micro">Daily quiz</h2>
        {quizzes.isPending ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : quizzes.isError ? (
          <div className="rounded-xl border border-border bg-card py-8">
            <QueryErrorState
              title="Could not load your quizzes"
              error={quizzes.error}
              retrying={quizzes.isFetching}
              onRetry={() => void quizzes.refetch()}
            />
          </div>
        ) : quizzes.data.length === 0 ? (
          <EmptyState
            title="No quiz right now"
            body="Daily quizzes are sent out on a schedule. When one is waiting for you, it shows up here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {quizzes.data.map((quiz) => (
              <QuizCard key={quiz.id} quiz={quiz} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="label-micro">Your classes</h2>
        {classes.isPending ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : classes.isError ? (
          <div className="rounded-xl border border-border bg-card py-8">
            <QueryErrorState
              title="Could not load your classes"
              error={classes.error}
              retrying={classes.isFetching}
              onRetry={() => void classes.refetch()}
            />
          </div>
        ) : classes.data.length === 0 ? (
          <EmptyState
            title="You are not enrolled yet"
            body="Your training manager adds you to a class. Once that happens, it appears here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {classes.data.map((row) => (
              <ClassCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ClassCard({ row }: { row: MyClass }) {
  const total = row.exercise_count
  const done = row.completed_exercise_count

  return (
    <Link
      to={`/learner/classes/${row.id}`}
      className="group flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 transition-colors outline-none hover:border-ring/40 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="font-medium text-foreground">{row.name}</h3>
        {row.description !== null && row.description !== "" && (
          <p className="max-w-prose text-sm break-words text-muted-foreground">
            {row.description}
          </p>
        )}
        <p className="numeric text-sm text-muted-foreground">
          {formatRange(row.start_date, row.end_date)}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="numeric text-foreground">
            {done} of {total}
          </span>{" "}
          {total === 1 ? "exercise done" : "exercises done"}
        </p>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </div>
    </Link>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
