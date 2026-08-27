import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type MyClass = components["schemas"]["MyClassResponse"]
export type MyExercise = components["schemas"]["LearnerExerciseSummary"]

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
