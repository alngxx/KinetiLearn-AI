import {
  BookOpenIcon,
  ChevronLeftIcon,
  ClipboardListIcon,
  DownloadIcon,
  RefreshCwIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Link, useOutletContext, useParams } from "react-router-dom"
import { EmptyState } from "@/components/EmptyState"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { ResultBadge } from "@/components/ResultBadge"
import { SectionLabel } from "@/components/SectionLabel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { LearnerChatContext } from "@/layouts/LearnerLayout"
import { isApiError } from "@/lib/errors"
import { useChatSessions } from "@/modules/chat/queries"
import { formatMoment } from "@/modules/learner-home/dates"
import {
  bestSubmissionByExercise,
  useClassDocumentDownload,
  useMyClassDocuments,
  useMyClassExercises,
  useMyClasses,
  useMySubmissions,
  type MyClassDocument,
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

  const documents = useMyClassDocuments(classId)
  // Whether a class-scoped chat already exists, so the button can say "Resume
  // studying" rather than silently starting a second one. Newest first from
  // the server, so the first row is the one to resume.
  const classChats = useChatSessions(classId)
  const existingSessionId = classChats.data?.[0]?.id ?? null
  const { openClassChat } = useOutletContext<LearnerChatContext>()

  return (
    // pt-6 reuses this page's own gap-6 rhythm: the layout's <main> has no
    // top padding of its own (PortalHero supplies that on the pages built
    // around the sky band), so a page that opens with this back link instead
    // needs its own clearance from the sticky header.
    <div className="flex flex-col gap-6 pt-6">
      <Link
        to="/learner"
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/75"
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
        actions={
          // Waits on classChats rather than defaulting to "Study with AI
          // mentor": clicking mid-fetch would start a second conversation
          // instead of resuming the one that is about to be found.
          classChats.isPending ? (
            <Button disabled>Study with AI mentor</Button>
          ) : (
            <Button onClick={() => openClassChat(classId, existingSessionId)}>
              {existingSessionId !== null ? "Resume studying" : "Study with AI mentor"}
            </Button>
          )
        }
      />

      <section className="flex flex-col gap-3.5">
        <SectionLabel>Materials</SectionLabel>
        {documents.isPending ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : documents.isError ? (
          <div className="surface py-8">
            <QueryErrorState
              title="Could not load these materials"
              error={documents.error}
              retrying={documents.isFetching}
              onRetry={() => void documents.refetch()}
            />
          </div>
        ) : documents.data.length === 0 ? (
          <EmptyState
            icon={BookOpenIcon}
            title="No materials yet"
            body="Nothing has been uploaded for this class so far. It will appear here once it is."
          />
        ) : (
          <MaterialsList classId={classId} documents={documents.data} />
        )}
      </section>

      <section className="flex flex-col gap-3.5">
        <SectionLabel>Exercises</SectionLabel>
        {exercises.isPending ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : exercises.isError ? (
          <div className="surface py-8">
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
      </section>
    </div>
  )
}

// Grouped by category, matching the order the server already returns
// (category name, then title).
function MaterialsList({
  classId,
  documents,
}: {
  classId: string
  documents: MyClassDocument[]
}) {
  const groups: { category: string | null; rows: MyClassDocument[] }[] = []
  for (const doc of documents) {
    const current = groups.at(-1)
    if (current !== undefined && current.category === doc.category_name) {
      current.rows.push(doc)
    } else {
      groups.push({ category: doc.category_name, rows: [doc] })
    }
  }

  return (
    <div className="surface divide-y divide-border overflow-hidden">
      {groups.map((group) => (
        <div key={group.category ?? "uncategorised"} className="p-3.5">
          {group.category !== null && (
            <p className="label-micro mb-2">{group.category}</p>
          )}
          <ul className="flex flex-col gap-2">
            {group.rows.map((doc) => (
              <li key={doc.id}>
                <MaterialRow classId={classId} doc={doc} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// One mutation per row rather than one for the list: a shared one would put
// every row in the pending state at once, and a failure on one row would read
// as a failure of all of them.
function MaterialRow({ classId, doc }: { classId: string; doc: MyClassDocument }) {
  const download = useClassDocumentDownload(classId)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 break-words text-sm text-foreground">{doc.title}</span>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline">{doc.format}</Badge>
          {/* Named for the document, not the icon — "Download" on its own
              repeats once per row and tells a screen reader nothing. The name
              also carries the pending state, which is otherwise only a spin:
              same reason QueryErrorState's button says "Retrying…".

              44px on a phone, back to the compact size from md up — the same
              call the chat panel's close button makes, and mis-tapping a row
              here fetches the wrong file. */}
          <Button
            variant="ghost"
            size="icon-sm"
            // Muted at rest so a list of ten materials reads as a reference
            // list rather than ten dark icons competing with the titles; ghost
            // already brings it up on hover, and focus-visible matches that for
            // the keyboard. Same idiom as the back link at the top of the page.
            className="size-11 text-muted-foreground focus-visible:text-foreground md:size-7"
            disabled={download.isPending}
            aria-label={
              download.isPending ? `Downloading ${doc.title}` : `Download ${doc.title}`
            }
            onClick={() => download.mutate(doc.id)}
          >
            {download.isPending ? (
              // The app's one spin idiom, borrowed from QueryErrorState —
              // motion-safe so a reduced-motion preference gets a still icon
              // rather than none at all.
              <RefreshCwIcon className="motion-safe:animate-spin" />
            ) : (
              <DownloadIcon />
            )}
          </Button>
        </div>
      </div>

      {/* The server's own wording: it is the only side that knows whether this
          was a membership problem or a missing file. The row returns to idle
          either way, so a retry is always one click away. */}
      {download.isError && (
        <p role="alert" className="text-xs text-destructive">
          {isApiError(download.error)
            ? download.error.message
            : "Something went wrong. Please try again."}
        </p>
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
    <article className="flex flex-col gap-3 surface p-5">
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
            className="text-sm text-muted-foreground underline-offset-4 transition-colors outline-none hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/75"
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
