import { ChevronLeftIcon, ClipboardListIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Link, useParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { ResultBadge } from "@/components/ResultBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatMoment } from "@/modules/learner-home/dates"
import {
  bestSubmissionByExercise,
  useMyClassExercises,
  useMyClasses,
  useMySubmissions,
  type MyExercise,
} from "@/modules/learner-home/queries"

export function LearnerClassPage() {
  const { classId } = useParams()
  // The route cannot match without the segment, so this is only for the type.
  return <ClassView key={classId} classId={classId ?? ""} />
}

function ClassView({ classId }: { classId: string }) {
  const exercises = useMyClassExercises(classId)
  // Only for the name in the header — /classes/{id}/exercises returns exercises,
  // not the class itself, and there is no learner-facing class detail endpoint.
  const classes = useMyClasses()
  const row = classes.data?.find((item) => item.id === classId)
  // Only to link a card to the attempt its Best figure came from. A failure here
  // costs the link and nothing else, so the page does not wait on it or report
  // it — the exercises are still readable and still startable.
  const submissions = useMySubmissions(classId)
  const bestSubmissions = bestSubmissionByExercise(submissions.data ?? [])

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
        eyebrow="Class"
        title={row?.name ?? "Class"}
        description={
          row?.description !== null && row?.description !== undefined && row.description !== ""
            ? row.description
            : "The exercises assigned to this class, and how you have done on them."
        }
      />

      {exercises.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : exercises.isError ? (
        <div className="rounded-xl border border-border bg-card py-10">
          <QueryErrorState
            title="Could not load these exercises"
            error={exercises.error}
            retrying={exercises.isFetching}
            onRetry={() => void exercises.refetch()}
          />
        </div>
      ) : exercises.data.length === 0 ? (
        <EmptyState
          icon={ClipboardListIcon}
          title="No exercises yet"
          body="Nothing has been assigned to this class so far. It will appear here once it is."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {exercises.data.map((exercise) => (
            <li key={exercise.id}>
              <ExerciseCard
                exercise={exercise}
                bestSubmissionId={bestSubmissions.get(exercise.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ExerciseCard({
  exercise,
  bestSubmissionId,
}: {
  exercise: MyExercise
  bestSubmissionId: string | undefined
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="font-medium break-words text-foreground">{exercise.title}</h3>
          {exercise.description !== null && exercise.description !== "" && (
            <p className="max-w-prose text-sm break-words text-muted-foreground">
              {exercise.description}
            </p>
          )}
        </div>
        <ResultBadge isPassed={exercise.is_passed} />
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
        <Fact label="Closes">
          <time dateTime={exercise.end_time}>{formatMoment(exercise.end_time)}</time>
        </Fact>
        <Fact label="Questions">{exercise.question_count}</Fact>
        <Fact label="Time">{exercise.duration_minutes} min</Fact>
        <Fact label="Pass mark">
          {exercise.pass_score} / {exercise.total_points}
        </Fact>
        <Fact label="Attempts">{exercise.attempt_count}</Fact>
        {exercise.best_score !== null && <Fact label="Best">{exercise.best_score}</Fact>}
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        {/* Always offered. Whether the exam is open is the server's to answer —
            it refuses one that has not started yet, with its own wording — and
            guessing that here would mean duplicating the rule. */}
        <Button asChild>
          <Link to={`/learner/exams/${exercise.id}/take`}>
            {exercise.attempt_count === 0 ? "Start" : "Try again"}
          </Link>
        </Button>
        {bestSubmissionId !== undefined && (
          <Link
            to={`/learner/exams/${exercise.id}/result/${bestSubmissionId}`}
            className="text-sm text-muted-foreground underline-offset-4 transition-colors outline-none hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            See your best attempt
          </Link>
        )}
      </div>

      {/* Empty for a multi-document exam, which awards no skill points at all —
          so no skills is a real answer, not a missing one. */}
      {exercise.skill_names.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {exercise.skill_names.map((name) => (
            <li key={name}>
              <Badge variant="outline">{name}</Badge>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="label-micro">{label}</dt>
      <dd className="numeric text-foreground">{children}</dd>
    </div>
  )
}
