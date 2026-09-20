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

// Mirrors the server's own limits so an obviously bad file is refused before it
// crosses the wire. The server re-checks by sniffing the bytes; this is only to
// save a round trip, never the real gate.
export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"]
export const AVATAR_MAX_SIZE = 2 * 1024 * 1024

export function getMe() {
  return api.get<UserRow>("/api/v1/users/me")
}

// avatar_url on the way out is a short-lived signed URL, not the key the server
// stores. Both endpoints return the whole updated user, so the caller can drop
// the result straight into the cache.
export function uploadAvatar(file: File) {
  const form = new FormData()
  form.set("file", file)
  return api.post<UserRow>("/api/v1/users/me/avatar", form)
}

export function removeAvatar() {
  return api.delete<UserRow>("/api/v1/users/me/avatar")
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
