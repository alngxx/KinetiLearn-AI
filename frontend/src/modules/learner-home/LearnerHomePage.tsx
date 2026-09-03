import { CalendarClockIcon, ChevronRightIcon, UsersIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { SectionLabel } from "@/components/SectionLabel"
import { staggerStyle } from "@/lib/stagger"
import { PortalHero } from "@/components/PortalHero"
import { QueryErrorState } from "@/components/QueryErrorState"
import { cn } from "@/lib/utils"
import { QuizCard } from "@/modules/daily-quiz/QuizCard"
import { useTodayQuizzes } from "@/modules/daily-quiz/queries"
import { formatRange } from "@/modules/learner-home/dates"
import { useMyClasses, type MyClass } from "@/modules/learner-home/queries"

export function LearnerHomePage() {
  const quizzes = useTodayQuizzes()
  const classes = useMyClasses()

  return (
    <div className="flex flex-col">
      <PortalHero
        eyebrow="Home"
        title="Your training"
        description="Today’s quiz and the classes you are enrolled in."
      />

      {/* The gap the horizon rule sits in. --band-h is measured from the top of
          the viewport, so the hero's height plus this lead is what puts the rule
          in clear air rather than through a card or up against a label. */}
      <div className="flex flex-col gap-[34px] pt-[34px]">
        <section className="flex flex-col gap-3.5">
          <SectionLabel>Daily quiz</SectionLabel>
          {quizzes.isPending ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : quizzes.isError ? (
            <div className="surface py-8">
              <QueryErrorState
                title="Could not load your quizzes"
                error={quizzes.error}
                retrying={quizzes.isFetching}
                onRetry={() => void quizzes.refetch()}
              />
            </div>
          ) : quizzes.data.length === 0 ? (
            <EmptyState
              icon={CalendarClockIcon}
              title="No quiz right now"
              body="Daily quizzes are sent out on a schedule. When one is waiting for you, it shows up here."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {quizzes.data.map((quiz, index) => (
                <QuizCard
                  key={quiz.id}
                  quiz={quiz}
                  className="enter-stagger"
                  style={staggerStyle(index, { step: "40ms" })}
                />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3.5">
          <SectionLabel>Your classes</SectionLabel>
          {classes.isPending ? (
            <p role="status" className="py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : classes.isError ? (
            <div className="surface py-8">
              <QueryErrorState
                title="Could not load your classes"
                error={classes.error}
                retrying={classes.isFetching}
                onRetry={() => void classes.refetch()}
              />
            </div>
          ) : classes.data.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="You are not enrolled yet"
              body="Your training manager adds you to a class. Once that happens, it appears here."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {classes.data.map((row, index) => (
                <ClassCard key={row.id} row={row} index={index} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function ClassCard({ row, index }: { row: MyClass; index: number }) {
  const total = row.exercise_count
  const done = row.completed_exercise_count

  return (
    <Link
      to={`/learner/classes/${row.id}`}
      style={staggerStyle(index, { step: "40ms" })}
      className="enter-stagger group flex flex-wrap items-center gap-5 surface px-6 py-[22px] transition-[border-color,box-shadow] outline-none hover:border-[color-mix(in_oklab,var(--ring)_50%,transparent)] hover:shadow-[var(--elevation-raised),0_0_0_3px_var(--glow)] focus-visible:ring-3 focus-visible:ring-ring/75"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-[17px] font-semibold tracking-[-0.02em] break-words text-foreground">
          {row.name}
        </h3>
        {row.description !== null && row.description !== "" && (
          <p className="max-w-prose text-sm break-words text-muted-foreground">
            {row.description}
          </p>
        )}
        <p className="numeric text-[11.5px] text-muted-foreground">
          {formatRange(row.start_date, row.end_date)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {total === 0 ? (
          // A class with nothing assigned has no progress to show. A bar here
          // would have to invent a denominator, and 0 of 0 reads as failure
          // rather than as "nothing has been set yet".
          <p className="text-[13px] text-muted-foreground">No exercises yet</p>
        ) : (
          <ClassProgress done={done} total={total} />
        )}
        <ChevronRightIcon
          aria-hidden="true"
          className="size-[15px] text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </div>
    </Link>
  )
}

function ClassProgress({ done, total }: { done: number; total: number }) {
  const percent = Math.min(100, Math.round((done / total) * 100))

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-muted-foreground">
        <span className="numeric text-foreground">
          {done} of {total}
        </span>{" "}
        {total === 1 ? "exercise done" : "exercises done"}
      </p>
      {/* The line above already states the exact value, so the bar repeats it
          visually and is hidden from screen readers — the same call
          ThresholdLadder and SkillBandBar make. Brass while there is still work
          left, green once the class is finished, matching the Answered badge
          and ResultBadge. Nothing started leaves an empty track, which reads as
          not-started without needing a third colour. */}
      <div
        aria-hidden="true"
        className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", done >= total ? "bg-success" : "bg-ring")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
