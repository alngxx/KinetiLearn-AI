import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type MyClass = components["schemas"]["MyClassResponse"]
export type MyExercise = components["schemas"]["LearnerExerciseSummary"]
export type MySubmission = components["schemas"]["SubmissionResponse"]
export type MyClassDocument = components["schemas"]["LearnerDocumentSummary"]
export type ClassDocumentDownload = components["schemas"]["LearnerDocumentDownload"]

// Both routes live on my_classes_router, which is mounted before the admin one
// so /classes/me is not matched as /classes/{class_id}.
export function listMyClasses() {
  return api.get<MyClass[]>("/api/v1/classes/me")
}

// The server checks membership first, so a class the learner is not in comes
// back as an error rather than an empty list.
export function listMyClassExercises(classId: string) {
  return api.get<MyExercise[]>(`/api/v1/classes/${classId}/exercises`)
}

// The learner's own submissions, narrowed to one class. This is what makes a
// past result reachable: the class summary carries best_score but no submission
// id, and there is no other learner-facing way to find one. Ordered newest
// first by the server.
export function listMySubmissions(classId: string) {
  return api.get<MySubmission[]>(`/api/v1/submissions/me?class_id=${classId}`)
}

// Title, category, format — no key and no URL. Restricted server-side to
// documents the AI Mentor can actually answer from, so Materials and the
// mentor's knowledge never disagree. 403s the same way exercises does for a
// class the learner is not in.
export function listMyClassDocuments(classId: string) {
  return api.get<MyClassDocument[]>(`/api/v1/classes/${classId}/documents`)
}

// Mints a signed URL good for a few minutes, behind the same membership check
// the list itself uses. Called per click and never cached — the response is a
// short-lived credential, not a property of the document.
export function getClassDocumentDownload(classId: string, documentId: string) {
  return api.get<ClassDocumentDownload>(
    `/api/v1/classes/${classId}/documents/${documentId}/download`,
  )
}
