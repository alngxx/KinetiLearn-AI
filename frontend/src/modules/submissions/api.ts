import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type SubmissionRow = components["schemas"]["SubmissionResponse"]
export type SubmissionDetail = components["schemas"]["SubmissionDetailResponse"]
export type Exercise = components["schemas"]["ExerciseResponse"]
export type ClassRow = components["schemas"]["ClassResponse"]
export type ClassDetail = components["schemas"]["ClassDetailResponse"]
export type UserRow = components["schemas"]["UserResponse"]

export type SubmissionFilters = {
  class_id?: string
  user_id?: string
  exercise_id?: string
}

// Exactly the three query params list_for_admin accepts (submissions/router.py) —
// nothing wider is offered.
export function listSubmissions(filters: SubmissionFilters) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") search.set(key, value)
  }
  const query = search.toString()
  return api.get<SubmissionRow[]>(`/api/v1/submissions${query === "" ? "" : `?${query}`}`)
}

export function getSubmission(id: string) {
  return api.get<SubmissionDetail>(`/api/v1/submissions/${id}`)
}

// score >= 0 is enforced by ScoreUpdate itself (Field(..., ge = 0)); the upper
// bound against exercise.total_points is enforced server-side in
// update_score, so the client mirrors it rather than owning it.
export function overrideScore(id: string, score: number) {
  return api.patch<SubmissionRow>(`/api/v1/submissions/${id}`, { score })
}

export function listClasses() {
  return api.get<ClassRow[]>("/api/v1/classes")
}

export function getClass(id: string) {
  return api.get<ClassDetail>(`/api/v1/classes/${id}`)
}

export function getExercise(id: string) {
  return api.get<Exercise>(`/api/v1/exams/${id}`)
}

// There is no global exercise-owning-class list; /users applies no role
// filter of its own, so it is set here, matching how classes' bulk-enroll
// preview does the same on the same endpoint.
export function listLearners() {
  return api.get<UserRow[]>("/api/v1/users?role=learner")
}

export function getUser(id: string) {
  return api.get<UserRow>(`/api/v1/users/${id}`)
}
