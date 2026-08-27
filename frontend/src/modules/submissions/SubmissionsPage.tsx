import { Link } from "react-router-dom"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { ResultBadge } from "@/components/ResultBadge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useUrlFilters } from "@/lib/useUrlFilters"
import { formatMoment } from "@/modules/submissions/dates"
import { useClasses, useExerciseDirectory, useLearners, useSubmissions } from "@/modules/submissions/queries"

const selectClasses =
  "h-8 w-48 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"

const FILTER_KEYS = ["class_id", "user_id", "exercise_id"] as const

export function SubmissionsPage() {
  const { values, setFilter } = useUrlFilters(FILTER_KEYS)
  const classId = values.class_id
  const userId = values.user_id
  const exerciseId = values.exercise_id

  const classes = useClasses()
  const learners = useLearners()
  const directory = useExerciseDirectory()
  const list = useSubmissions({
    class_id: classId || undefined,
    user_id: userId || undefined,
    exercise_id: exerciseId || undefined,
  })

  const exerciseById = new Map(directory.entries.map((entry) => [entry.exerciseId, entry]))
  const learnerById = new Map((learners.data ?? []).map((row) => [row.id, row.full_name]))

  const rows = list.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Review"
        title="Submissions"
        description="Exam submissions across every class, with the option to correct a score by hand. Daily quiz attempts have no admin review yet."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-class" className="label-micro">
            Class
          </label>
          <select
            id="filter-class"
            value={classId}
            onChange={(event) => setFilter("class_id", event.target.value)}
            className={selectClasses}
          >
            <option value="">All</option>
            {(classes.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-learner" className="label-micro">
            Learner
          </label>
          <select
            id="filter-learner"
            value={userId}
            onChange={(event) => setFilter("user_id", event.target.value)}
            className={selectClasses}
          >
            <option value="">All</option>
            {(learners.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.full_name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="filter-exercise" className="label-micro">
            Exam
          </label>
          <select
            id="filter-exercise"
            value={exerciseId}
            onChange={(event) => setFilter("exercise_id", event.target.value)}
            className={selectClasses}
          >
            <option value="">All</option>
            {directory.entries.map((entry) => (
              <option key={entry.exerciseId} value={entry.exerciseId}>
                {entry.title} — {entry.className}
              </option>
            ))}
          </select>
        </div>

        <span className="ml-auto text-sm text-muted-foreground">
          <span className="numeric text-foreground">{rows.length}</span>{" "}
          {rows.length === 1 ? "submission" : "submissions"}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <span className="label-micro">Learner</span>
              </TableHead>
              <TableHead>
                <span className="label-micro">Exam</span>
              </TableHead>
              <TableHead className="w-20">
                <span className="label-micro">Attempt</span>
              </TableHead>
              <TableHead className="w-24">
                <span className="label-micro">Score</span>
              </TableHead>
              <TableHead className="w-28">
                <span className="label-micro">Result</span>
              </TableHead>
              <TableHead className="w-48">
                <span className="label-micro">Submitted</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? (
              <TableRow>
                <TableCell
                  role="status"
                  colSpan={6}
                  className="py-10 text-center text-muted-foreground"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : list.isError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-10 text-center">
                  <QueryErrorState
                    title="Could not load submissions"
                    error={list.error}
                    retrying={list.isFetching}
                    onRetry={() => void list.refetch()}
                  />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No submissions match</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Clear the filters, or check back once someone has submitted.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const exercise = exerciseById.get(row.exercise_id)
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      {learnerById.get(row.user_id) ?? (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell className="min-w-0 max-w-sm">
                      <div className="flex min-w-0 flex-col">
                        <Link
                          to={`/admin/submissions/${row.id}`}
                          className="w-fit font-medium break-words underline-offset-4 transition-colors outline-none hover:text-ring hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {exercise?.title ?? "Exam"}
                        </Link>
                        {exercise !== undefined && (
                          <span className="text-xs text-muted-foreground">
                            {exercise.className}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="numeric text-sm text-muted-foreground">
                        {row.attempt_number}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="numeric text-sm">{row.score ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <ResultBadge isPassed={row.is_passed} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="numeric text-xs text-muted-foreground">
                          {row.submitted_at === null ? "—" : formatMoment(row.submitted_at)}
                        </span>
                        {row.is_late && (
                          <span className="text-xs text-muted-foreground">Late</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
