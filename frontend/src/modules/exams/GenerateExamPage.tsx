import { ChevronLeftIcon, Loader2Icon, SparklesIcon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
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
} from "@/modules/exams/api"
import { DocumentPicker } from "@/modules/exams/DocumentPicker"
import { QuestionCountField } from "@/modules/exams/QuestionCountField"
import { useExamLookups, useGenerateExercise } from "@/modules/exams/queries"

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
  const [selected, setSelected] = useState<string[]>([])
  const [documentsError, setDocumentsError] = useState<string | undefined>(undefined)

  const lookups = useExamLookups()
  const generate = useGenerateExercise()

  const form = useEntityForm({
    fields: FIELDS,
    // The class is pre-filled from the route, so arriving from a class answers
    // the question — but it stays a picker so the exam can be retargeted here.
    initial: { title: "", class_id: classId, num_questions: "10", prompt: "" },
    validate: validateCount,
    onSubmit: async (values) => {
      if (validateDocuments(selected) !== undefined) return
      const exercise = await generate.mutateAsync({
        title: values.title.trim(),
        class_id: values.class_id,
        document_ids: selected,
        num_questions: Number(values.num_questions),
        prompt: values.prompt.trim(),
      })
      navigate(`/admin/classes/${values.class_id}/exercises/${exercise.id}`, { replace: true })
    },
  })

  // Both run on every attempt so a blank form reports the missing documents and
  // the missing title together, not one and then the other.
  function handleSubmit() {
    setDocumentsError(validateDocuments(selected))
    void form.submit()
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

      {form.submitting ? (
        <WaitingPanel
          questionCount={questionCount}
          documentCount={selected.length}
        />
      ) : (
        <div className="flex max-w-2xl flex-col gap-4">
          {form.formError !== null && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <p className="text-sm font-medium text-destructive">Generation failed</p>
              <p className="text-sm text-muted-foreground">{form.formError}</p>
              <p className="text-sm text-muted-foreground">
                Nothing was saved in most cases, but check the class page for a stray draft
                before generating again.
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
                {form.formError === null ? "Generate exam" : "Try again"}
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

// Generation is synchronous and can run for minutes, so this owns the wait
// rather than a dialog the admin could dismiss out from under it.
function WaitingPanel({
  questionCount,
  documentCount,
}: {
  questionCount: number
  documentCount: number
}) {
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
          Writing {questionCount} {questionCount === 1 ? "question" : "questions"} from{" "}
          {documentCount} {documentCount === 1 ? "document" : "documents"}…
        </p>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        This runs in batches of ten and can take a few minutes. The page moves on by itself
        when the draft is ready.
      </p>
      {/* The server has no disconnect check: the request runs to completion and
          commits whether or not the browser is still listening. Saying "leaving
          cancels it" would send an admin away believing they had stopped a job
          that is in fact still running and still billing. */}
      <p className="max-w-prose text-sm text-muted-foreground">
        Leaving this page won&rsquo;t stop generation. The exam may still be created without
        you seeing it — if that happens you&rsquo;ll find it as a draft on the class page.
      </p>
    </div>
  )
}
