import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type UserRow = components["schemas"]["UserResponse"]

export type UserFilters = {
  role?: string
  department_id?: string
  seniority_id?: string
  employee_level_id?: string
}

// The four config lists this page tags people with. Users owns its own calls so
// nothing here reaches into another feature's api module.
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

export function listUsers(filters: UserFilters) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") search.set(key, value)
  }
  const query = search.toString()
  return api.get<UserRow[]>(`/api/v1/users${query === "" ? "" : `?${query}`}`)
}

export function createUser(body: Record<string, unknown>) {
  return api.post<UserRow>("/api/v1/users", body)
}

// PUT, but every field is optional, so it behaves as a partial update.
export function updateUser(id: string, body: Record<string, unknown>) {
  return api.put<UserRow>(`/api/v1/users/${id}`, body)
}

export function setUserActive(id: string, active: boolean) {
  return api.patch<UserRow>(`/api/v1/users/${id}/${active ? "activate" : "deactivate"}`)
}

export function listLookup(name: LookupName) {
  return api.get<LookupRow[]>(LOOKUP_PATHS[name])
}
