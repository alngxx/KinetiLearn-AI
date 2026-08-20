import { api } from "@/lib/apiClient"

// Every config entity shares this response core; the descriptor decides which
// extra fields are shown.
export type ConfigRow = {
  id: string
  name: string
  is_active: boolean
  created_at: string
  description?: string | null
  rank?: number
  category_id?: string
  basic_max?: number
  intermediate_max?: number
}

export type ListParams = {
  include_inactive?: boolean
  category_id?: string
}

function queryString(params: ListParams): string {
  const search = new URLSearchParams()
  if (params.include_inactive === true) search.set("include_inactive", "true")
  if (params.category_id !== undefined) search.set("category_id", params.category_id)
  const value = search.toString()
  return value === "" ? "" : `?${value}`
}

export function listEntities(basePath: string, params: ListParams = {}) {
  return api.get<ConfigRow[]>(`${basePath}${queryString(params)}`)
}

export function createEntity(basePath: string, body: Record<string, unknown>) {
  return api.post<ConfigRow>(basePath, body)
}

// The API takes PUT for updates even though every field is optional, so this
// behaves as a partial update.
export function updateEntity(basePath: string, id: string, body: Record<string, unknown>) {
  return api.put<ConfigRow>(`${basePath}/${id}`, body)
}

export function setEntityActive(basePath: string, id: string, active: boolean) {
  return api.patch<ConfigRow>(`${basePath}/${id}/${active ? "activate" : "deactivate"}`)
}
