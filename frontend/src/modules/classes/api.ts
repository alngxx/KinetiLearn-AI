import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type ClassRow = components["schemas"]["ClassResponse"]
export type ClassDetail = components["schemas"]["ClassDetailResponse"]
export type ClassExercise = components["schemas"]["ClassExerciseSummary"]
export type EnrollFilters = components["schemas"]["BulkAddMembersRequest"]
export type EnrollResult = components["schemas"]["BulkAddMembersResponse"]
export type ClassDeleteResult = components["schemas"]["DeleteResponse"]

type UserRow = components["schemas"]["UserResponse"]

// The three lists bulk enrolment can target. Classes owns its own calls so
// nothing here reaches into another feature's api module.
export const LOOKUP_PATHS = {
  departments: "/api/v1/config/departments",
  seniority_levels: "/api/v1/config/seniority-levels",
  employee_levels: "/api/v1/config/employee-levels",
} as const

export type LookupName = keyof typeof LOOKUP_PATHS

export type LookupRow = {
  id: string
  name: string
}

export function listClasses(includeInactive: boolean) {
  return api.get<ClassRow[]>(
    `/api/v1/classes${includeInactive ? "?include_inactive=true" : ""}`,
  )
}

export function getClass(id: string) {
  return api.get<ClassDetail>(`/api/v1/classes/${id}`)
}

export function createClass(body: Record<string, unknown>) {
  return api.post<ClassRow>("/api/v1/classes", body)
}

// PUT, but every field is optional, so it behaves as a partial update.
export function updateClass(id: string, body: Record<string, unknown>) {
  return api.put<ClassRow>(`/api/v1/classes/${id}`, body)
}

// Permanent. The server refuses with a 409 while the class still has
// exercises; that message is written for the admin and is shown as-is.
// Members go with the class (ON DELETE CASCADE).
export function deleteClass(id: string) {
  return api.delete<ClassDeleteResult>(`/api/v1/classes/${id}`)
}

export function setClassActive(id: string, active: boolean) {
  return api.patch<ClassRow>(`/api/v1/classes/${id}/${active ? "activate" : "deactivate"}`)
}

export function bulkAddMembers(id: string, filters: EnrollFilters) {
  return api.post<EnrollResult>(`/api/v1/classes/${id}/members/bulk`, filters)
}

// The server rejects an empty filter set with a 400 rather than treating it as
// "everyone", so the dialog and the preview both gate on this.
export function hasEnrollFilter(filters: EnrollFilters): boolean {
  return Object.values(filters).some(
    (value) => value !== undefined && value !== null && value !== "",
  )
}

// Mirrors what bulk_add_members matches on: role "learner", is_active, and the
// filters ANDed together. /users applies no role or is_active rule of its own,
// so role goes on the query and is_active is applied to the rows — the count
// then equals the total_matched the POST will report, not an estimate.
export async function countEnrollMatches(filters: EnrollFilters): Promise<number> {
  const search = new URLSearchParams({ role: "learner" })
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value)
  }
  const rows = await api.get<UserRow[]>(`/api/v1/users?${search.toString()}`)
  return rows.filter((row) => row.is_active).length
}

export function listLookup(name: LookupName) {
  return api.get<LookupRow[]>(LOOKUP_PATHS[name])
}
