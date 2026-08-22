import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type Exercise = components["schemas"]["ExerciseResponse"]
export type Question = components["schemas"]["QuestionResponse"]
export type QuestionOption = components["schemas"]["QuestionOptionResponse"]
export type QuestionUpdate = components["schemas"]["QuestionUpdate"]
export type OptionUpdate = components["schemas"]["OptionUpdate"]
export type FinalizeInput = components["schemas"]["FinalizeExerciseRequest"]
export type GenerateInput = components["schemas"]["GenerateExerciseRequest"]

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

export function generateExercise(body: GenerateInput) {
  return api.post<Exercise>("/api/v1/exams/generate", body)
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

export function finalizeExercise(id: string, body: FinalizeInput) {
  return api.put<Exercise>(`/api/v1/exams/${id}/finalize`, body)
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
