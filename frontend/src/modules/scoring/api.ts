import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type SkillBreakdownItem = components["schemas"]["SkillBreakdownItem"]
export type UserRow = components["schemas"]["UserResponse"]

export function getSkillBreakdown(userId: string) {
  return api.get<SkillBreakdownItem[]>(`/api/v1/scoring/users/${userId}/skills`)
}

export function getUser(userId: string) {
  return api.get<UserRow>(`/api/v1/users/${userId}`)
}
