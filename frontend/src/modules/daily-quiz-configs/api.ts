import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type DailyQuizConfigRow = components["schemas"]["DailyQuizConfigResponse"]

type DocumentRow = components["schemas"]["DocumentResponse"]

export type { DocumentRow }

// The four target columns daily quiz configs can filter learners by — a
// superset of the three classes' bulk-enroll uses (this also has job position).
// Owned here so nothing reaches into another feature's api module.
export const LOOKUP_PATHS = {
  departments: "/api/v1/config/departments",
  seniority_levels: "/api/v1/config/seniority-levels",
  job_positions: "/api/v1/config/job-positions",
  employee_levels: "/api/v1/config/employee-levels",
} as const

export type LookupName = keyof typeof LOOKUP_PATHS

export type LookupRow = {
  id: string
  name: string
}

export function listConfigs(includeInactive: boolean) {
  return api.get<DailyQuizConfigRow[]>(
    `/api/v1/daily-quiz-configs${includeInactive ? "?include_inactive=true" : ""}`,
  )
}

export function createConfig(body: Record<string, unknown>) {
  return api.post<DailyQuizConfigRow>("/api/v1/daily-quiz-configs", body)
}

// PUT, but every field is optional, so it behaves as a partial update. The
// server drops nulls (model_dump(exclude_none = True)), so a cleared end_date
// or target does not reach the row — see the CLEAR_UNSUPPORTED help text this
// module attaches to those fields on edit.
export function updateConfig(id: string, body: Record<string, unknown>) {
  return api.put<DailyQuizConfigRow>(`/api/v1/daily-quiz-configs/${id}`, body)
}

export function setConfigActive(id: string, active: boolean) {
  return api.patch<DailyQuizConfigRow>(
    `/api/v1/daily-quiz-configs/${id}/${active ? "activate" : "deactivate"}`,
  )
}

export function listLookup(name: LookupName) {
  return api.get<LookupRow[]>(LOOKUP_PATHS[name])
}

export function listDocuments() {
  return api.get<DocumentRow[]>("/api/v1/documents")
}

// Mirrors DailyQuizConfigService._check_document (quiz/service.py): a live
// document whose active version finished processing. Stricter than exams'
// picker, which skips the is_active check — this module's server-side rule
// checks it, so the client explains the same reason it would 400 on.
export function documentBlockedReason(row: DocumentRow): string | null {
  if (!row.is_active) return "Document is inactive"
  if (row.active_version_number === null) return "No active version"
  if (row.active_version_processing_status !== "ready") return "Active version is not ready"
  return null
}
