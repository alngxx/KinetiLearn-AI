import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type Exercise = components["schemas"]["ExerciseResponse"]
export type Question = components["schemas"]["QuestionResponse"]
export type QuestionOption = components["schemas"]["QuestionOptionResponse"]
export type QuestionUpdate = components["schemas"]["QuestionUpdate"]
export type OptionUpdate = components["schemas"]["OptionUpdate"]
export type FinalizeInput = components["schemas"]["FinalizeExerciseRequest"]
export type ExerciseUpdateInput = components["schemas"]["ExerciseUpdate"]
export type GenerateInput = components["schemas"]["GenerateExerciseRequest"]
export type GenerationJob = components["schemas"]["GenerationJobResponse"]

// The learner side of the same exercise. A different schema, not a subset by
// convention: LearnerExerciseDetail has no is_correct and no explanation on it
// anywhere, which is what keeps the answer key out of a take page.
export type LearnerExam = components["schemas"]["LearnerExerciseDetail"]
export type LearnerQuestion = components["schemas"]["LearnerQuestionOut"]
export type SubmitExamRequest = components["schemas"]["SubmitRequest"]
export type ExamSubmission = components["schemas"]["SubmissionDetailResponse"]

type DocumentRow = components["schemas"]["DocumentResponse"]
type ClassRow = components["schemas"]["ClassResponse"]

export type { ClassRow, DocumentRow }

// The generate request's own bounds, from GenerateExerciseRequest in
// exams/schemas.py. Mirrored here so the form reports them before the round trip.
export const MIN_DOCUMENTS = 1
export const MAX_DOCUMENTS = 10
export const MIN_QUESTIONS = 1
export const MAX_QUESTIONS = 50

// Generation reads each document's ACTIVE version and refuses one that has none
// or is not finished processing (exams/service.py). Same two rules, same wording,
// so a blocked document explains itself in the picker instead of at the server.
export function documentBlockedReason(row: DocumentRow): string | null {
  if (row.active_version_number === null) return "No active version"
  if (row.active_version_processing_status !== "ready") return "Active version is not ready"
  return null
}

export function listDocuments() {
  return api.get<DocumentRow[]>("/api/v1/documents")
}

export function listClasses() {
  return api.get<ClassRow[]>("/api/v1/classes")
}

export function getExercise(id: string) {
  return api.get<Exercise>(`/api/v1/exams/${id}`)
}

// 202, not 201: generation runs in the worker, so this returns a job to poll
// rather than the finished exercise. The exercise only exists once the job
// reaches "succeeded", which is what carries exercise_id.
export function generateExercise(body: GenerateInput) {
  return api.post<GenerationJob>("/api/v1/exams/generate", body)
}

// Attempt-agnostic: it never looks at submissions, so a retry and a first go
// get the same payload, and reading it after submitting is the same request
// again. Refused before start_time, but deliberately not after end_time —
// submitting late is allowed and only flagged.
export function getExamForLearner(exerciseId: string) {
  return api.get<LearnerExam>(`/api/v1/exams/${exerciseId}/take`)
}

export function submitExam(body: SubmitExamRequest) {
  return api.post<ExamSubmission>("/api/v1/submissions", body)
}

// Owner or admin only; anyone else gets a 403.
export function getSubmission(submissionId: string) {
  return api.get<ExamSubmission>(`/api/v1/submissions/${submissionId}`)
}

export function getGenerationJob(jobId: string) {
  return api.get<GenerationJob>(`/api/v1/exams/jobs/${jobId}`)
}

// Both question writes return the whole question back, not just what changed.
export function updateQuestion(questionId: string, body: QuestionUpdate) {
  return api.patch<Question>(`/api/v1/exams/questions/${questionId}`, body)
}

export function updateOption(questionId: string, optionId: string, body: OptionUpdate) {
  return api.patch<Question>(
    `/api/v1/exams/questions/${questionId}/options/${optionId}`,
    body,
  )
}

// Title only, and the server refuses while the exercise is live — same rule the
// question edits follow. Unpublishing back to a draft makes it editable again.
export function updateExercise(id: string, body: ExerciseUpdateInput) {
  return api.patch<Exercise>(`/api/v1/exams/${id}`, body)
}

export function finalizeExercise(id: string, body: FinalizeInput) {
  return api.put<Exercise>(`/api/v1/exams/${id}/finalize`, body)
}

// Refused (409) once the exercise has submissions or has already opened to
// learners — a submission row only exists after a final submit, so an open
// exam with none yet could still have someone mid-attempt.
export function unpublishExercise(id: string) {
  return api.patch<Exercise>(`/api/v1/exams/${id}/unpublish`)
}

// Deliberately no delete-all wrapper. DELETE /exams?confirm=true exists on the
// server and wipes every exercise in the database; an admin console has no
// business offering it, so it has no client here to call it from.
export function deleteExercise(id: string) {
  return api.delete<{ deleted: number }>(`/api/v1/exams/${id}`)
}

// One save can be several independent PATCHes, each committing on its own, so
// the diff is turned into an ordered, individually-reportable list rather than
// fired blind. The card runs them in this order and reports each outcome.
export type SaveStep =
  | { key: string; label: string; kind: "details"; body: QuestionUpdate }
  | { key: string; label: string; kind: "option"; optionId: string; body: OptionUpdate }

export type QuestionDraft = {
  question_text: string
  explanation: string
  points: string
  correctOptionId: string
  optionText: Record<string, string>
}

export function draftFromQuestion(question: Question): QuestionDraft {
  const optionText: Record<string, string> = {}
  for (const option of question.options) optionText[option.id] = option.option_text
  return {
    question_text: question.question_text,
    explanation: question.explanation ?? "",
    points: String(question.points),
    correctOptionId: question.options.find((option) => option.is_correct)?.id ?? "",
    optionText,
  }
}

function sentence(parts: string[]): string {
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

export function buildSaveSteps(question: Question, draft: QuestionDraft): SaveStep[] {
  const steps: SaveStep[] = []

  const body: QuestionUpdate = {}
  const changed: string[] = []
  const text = draft.question_text.trim()
  if (text !== question.question_text) {
    body.question_text = text
    changed.push("question text")
  }
  // Unlike the classes PUT, update_question dumps with exclude_unset, so an
  // explicit null here really does clear the column rather than being dropped.
  const explanation = draft.explanation.trim()
  const current = question.explanation ?? ""
  if (explanation !== current) {
    body.explanation = explanation === "" ? null : explanation
    changed.push("explanation")
  }
  const points = Number(draft.points)
  if (Number.isInteger(points) && points !== question.points) {
    body.points = points
    changed.push("points")
  }
  if (changed.length > 0) {
    // All three ride one request, so they can only succeed or fail together —
    // the label says which of them are riding on it.
    steps.push({ key: "details", label: sentence(changed), kind: "details", body })
  }

  const ordered = [...question.options].sort((a, b) =>
    a.option_label.localeCompare(b.option_label),
  )
  for (const option of ordered) {
    const next = (draft.optionText[option.id] ?? "").trim()
    if (next !== "" && next !== option.option_text) {
      steps.push({
        key: `option:${option.id}`,
        label: `Option ${option.option_label} text`,
        kind: "option",
        optionId: option.id,
        body: { option_text: next },
      })
    }
  }

  // Last on purpose: the answer key must never land on option text that failed
  // to save. Only ever sends true — clearing the last correct option is a 400.
  const wasCorrect = question.options.find((option) => option.is_correct)?.id ?? ""
  if (draft.correctOptionId !== "" && draft.correctOptionId !== wasCorrect) {
    steps.push({
      key: "correct",
      label: "Correct answer",
      kind: "option",
      optionId: draft.correctOptionId,
      body: { is_correct: true },
    })
  }

  return steps
}
