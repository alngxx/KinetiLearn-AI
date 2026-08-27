import { ChevronLeftIcon, Loader2Icon, SparklesIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { FieldRow } from "@/components/form/FieldRow"
import type { FormField, FormValues, Option } from "@/components/form/types"
import { useEntityForm } from "@/components/form/useEntityForm"
import { PageHeader } from "@/components/PageHeader"
import { Button } from "@/components/ui/button"
import {
  MAX_DOCUMENTS,
  MAX_QUESTIONS,
  MIN_DOCUMENTS,
  MIN_QUESTIONS,
  type GenerationJob,
} from "@/modules/exams/api"
import { DocumentPicker } from "@/modules/exams/DocumentPicker"
import { QuestionCountField } from "@/modules/exams/QuestionCountField"
import {
  useExamLookups,
  useExerciseCreated,
  useGenerateExercise,
  useGenerationJob,
} from "@/modules/exams/queries"

const TITLE_FIELD: FormField = {
  name: "title",
  label: "Title",
  kind: "text",
  required: true,
  maxLength: 255,
}

const CLASS_FIELD: FormField = {
  name: "class_id",
  label: "Class",
  kind: "select",
  required: true,
  optionsFrom: "classes",
}

// Rendered by QuestionCountField, not FieldRow — a preset dropdown with a custom
// escape hatch is more than one control. It stays in FIELDS so the shared
// required/integer checks and the server's 422 mapping still cover it.
const COUNT_FIELD: FormField = {
  name: "num_questions",
  label: "Questions",
  kind: "number",
  required: true,
}

const PROMPT_FIELD: FormField = {
  name: "prompt",
  label: "Instructions",
  kind: "textarea",
  placeholder: "e.g. Generate 20 hard-level MCQs covering the key concepts of these materials. ",
}

const FIELDS: FormField[] = [TITLE_FIELD, CLASS_FIELD, COUNT_FIELD, PROMPT_FIELD]

// The server's own bound, checked here so a bad count is caught before a call
// that costs money. validateFields already rules out non-integers and negatives.
export function validateCount(values: FormValues): Record<string, string> {
  const raw = (values.num_questions ?? "").trim()
  if (raw === "") return {}
  const count = Number(raw)
  if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
    return {
      num_questions: `Enter a whole number between ${MIN_QUESTIONS} and ${MAX_QUESTIONS}.`,
    }
  }
  return {}
}

export function validateDocuments(selected: string[]): string | undefined {
  if (selected.length < MIN_DOCUMENTS) return "Choose at least one document."
  if (selected.length > MAX_DOCUMENTS) return `Choose no more than ${MAX_DOCUMENTS} documents.`
  return undefined
}

export function GenerateExamPage() {
  const { classId } = useParams()
  return <GenerateView key={classId} classId={classId ?? ""} />
}

function GenerateView({ classId }: { classId: string }) {
  const navigate = useNavigate()
  // The job id lives in the URL so closing the page and coming back resumes the
  // wait instead of losing it — generation keeps running either way.
  const [searchParams, setSearchParams] = useSearchParams()
  const [selected, setSelected] = useState<string[]>([])
  const [documentsError, setDocumentsError] = useState<string | undefined>(undefined)

  const jobId = searchParams.get("job")
  const lookups = useExamLookups()
  const generate = useGenerateExercise()
  const job = useGenerationJob(jobId)
  const onCreated = useExerciseCreated()

  const status = job.data?.status
  // A job that cannot be read is as dead as one the worker failed: either way the
  // admin is watching something that will never finish.
  const failed = status === "failed" || job.isError

  const form = useEntityForm({
    fields: FIELDS,
    // The class is pre-filled from the route, so arriving from a class answers
    // the question — but it stays a picker so the exam can be retargeted here.
    initial: { title: "", class_id: classId, num_questions: "10", prompt: "" },
    validate: validateCount,
    onSubmit: async (values) => {
      if (validateDocuments(selected) !== undefined) return
      const created = await generate.mutateAsync({
        title: values.title.trim(),
        class_id: values.class_id,
        document_ids: selected,
        num_questions: Number(values.num_questions),
        prompt: values.prompt.trim(),
      })
      setSearchParams({ job: created.id }, { replace: true })
    },
  })

  // The draft only exists once the job says so, and class_id comes off the job
  // rather than the route — the form can retarget the exam to another class.
  useEffect(() => {
    const finished = job.data
    if (finished === undefined) return
    if (finished.status !== "succeeded" || finished.exercise_id === null) return
    onCreated(finished)
    navigate(
      `/admin/classes/${finished.class_id}/exercises/${finished.exercise_id}`,
      { replace: true },
    )
  }, [job.data, navigate, onCreated])

  // Both run on every attempt so a blank form reports the missing documents and
  // the missing title together, not one and then the other.
  function handleSubmit() {
    const problem = validateDocuments(selected)
    setDocumentsError(problem)
    // Drop the finished job before retrying, otherwise its error outlives it.
    if (jobId !== null) setSearchParams({}, { replace: true })
    // The document picker renders after every other field, so this fallback is
    // only reached once nothing above it failed — it never steals focus from
    // an earlier field error.
    void form.submit(problem === undefined ? undefined : "source-documents")
  }

  function toggle(id: string) {
    setDocumentsError(undefined)
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  const options: Record<string, Option[]> = {
    classes: lookups.classes.map((row) => ({ value: row.id, label: row.name })),
  }

  const count = Number(form.values.num_questions)
  const questionCount = Number.isInteger(count) && count > 0 ? count : MIN_QUESTIONS

  // Covers the gap between the click and the job id landing, then every state up
  // to and including success — the panel must not blink back to the form while
  // the navigation to the draft is in flight.
  const waiting = generate.isPending || (jobId !== null && !failed)

  const failureMessage = failed
    ? (job.data?.error ?? "Could not read the generation job.")
    : form.formError

  return (
    <div className="flex flex-col gap-6">
      <Link
        to={`/admin/classes/${classId}`}
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" />
        Back to class
      </Link>

      <PageHeader
        eyebrow="Exams"
        title="Generate exam"
        description="Pick the source material and say what the questions should cover. You get a draft you can edit before anyone sits it."
      />

      {waiting ? (
        <GenerationPanel
          job={job.data}
          questionCount={questionCount}
          documentCount={selected.length}
        />
      ) : (
        <div className="flex max-w-2xl flex-col gap-4">
          {failureMessage !== null && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <p className="text-sm font-medium text-destructive">Generation failed</p>
              <p className="text-sm text-muted-foreground">{failureMessage}</p>
              <p className="text-sm text-muted-foreground">
                Nothing was saved — a failed run leaves no draft behind. You can change
                the sources or instructions and try again.
              </p>
            </div>
          )}

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmit()
            }}
          >
            <FieldRow
              field={TITLE_FIELD}
              value={form.values.title ?? ""}
              error={form.errors.title}
              onChange={(value) => form.setValue("title", value)}
            />
            <FieldRow
              field={CLASS_FIELD}
              value={form.values.class_id ?? ""}
              error={form.errors.class_id}
              options={options.classes}
              onChange={(value) => form.setValue("class_id", value)}
            />
            <QuestionCountField
              value={form.values.num_questions ?? ""}
              error={form.errors.num_questions}
              onChange={(value) => form.setValue("num_questions", value)}
            />
            <FieldRow
              field={PROMPT_FIELD}
              value={form.values.prompt ?? ""}
              error={form.errors.prompt}
              onChange={(value) => form.setValue("prompt", value)}
            />

            <DocumentPicker
              rows={lookups.documents}
              loading={lookups.isPending}
              selected={selected}
              error={documentsError}
              onToggle={toggle}
            />

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={form.submitting}>
                <SparklesIcon />
                {failureMessage === null ? "Generate exam" : "Try again"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to={`/admin/classes/${classId}`}>Cancel</Link>
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}


// Generation runs for minutes in the worker, so this owns the wait rather than a
// dialog the admin could dismiss out from under it. It reports the job's real
// progress, but see the note in the panel: the count only moves once per LLM
// batch, so a short exam goes straight from queued to done.
function GenerationPanel({
  job,
  questionCount,
  documentCount,
}: {
  job: GenerationJob | undefined
  questionCount: number
  documentCount: number
}) {
  // Before the job lands, fall back to what the form asked for so the panel has
  // something truthful to show.
  const total = job?.num_questions ?? questionCount
  const done = job?.questions_done ?? 0
  const status = job?.status
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  // Deliberately no "reading sources" phase: progress is only observable per
  // batch, so anything finer would be invented rather than measured.
  const phase =
    status === undefined || status === "queued"
      ? "Queued"
      : status === "succeeded"
        ? "Saving draft…"
        : done === 0
          ? `Writing ${total} ${total === 1 ? "question" : "questions"}…`
          : `Writing questions — ${done} of ${total}`

  return (
    <div
      role="status"
      aria-busy="true"
      className="flex max-w-2xl flex-col items-start gap-3 rounded-xl border border-border bg-card p-6"
    >
      <div className="flex items-center gap-2.5">
        <Loader2Icon
          aria-hidden="true"
          className="size-4 text-ring motion-safe:animate-spin"
        />
        <p className="text-sm font-medium text-foreground">
          {phase}
          {documentCount > 0 && (
            <span className="text-muted-foreground">
              {" "}
              from {documentCount} {documentCount === 1 ? "document" : "documents"}
            </span>
          )}
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuetext={phase}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-ring motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* The count moves once per batch of ten (QUIZ_BATCH_SIZE in core/llm.py),
          so anything up to ten questions reports nothing until it is finished.
          Saying so is better than an admin reading a still bar as a stuck job. */}
      <p className="max-w-prose text-sm text-muted-foreground">
        Questions are written in batches of ten, so the count moves a batch at a time
        — a short exam goes straight from queued to done.
      </p>

      {/* Generation still cannot be cancelled: the worker runs the job to
          completion. What changed is that the wait is recoverable, so this now
          says leaving is safe without promising a cancel that does not exist.
          The last sentence covers the stale-job sweep (worker/tasks.py) and sits
          here on purpose — it qualifies "won't stop if you leave" immediately,
          so the two read as different triggers rather than a contradiction:
          leaving never stops a job, stalling does. No duration is named because
          there are two thresholds (queued vs stalled) and quoting either would
          be wrong half the time. */}
      <p className="max-w-prose text-sm text-muted-foreground">
        You can close this page and come back to this link — the wait picks up where
        it left off. Generation keeps running in the background and won&rsquo;t stop
        if you leave; the draft appears on the class page when it&rsquo;s ready. It
        won&rsquo;t run forever either: if progress stalls, the job is stopped
        automatically and reported here as a failure.
      </p>
    </div>
  )
}
