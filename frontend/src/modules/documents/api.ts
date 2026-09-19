import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type DocumentRow = components["schemas"]["DocumentResponse"]
export type DocumentDetail = components["schemas"]["DocumentDetailResponse"]
export type DocumentVersion = components["schemas"]["DocumentVersionDetail"]
export type UploadResult = components["schemas"]["DocumentUploadResponse"]
export type DocumentDeleteResult = components["schemas"]["DocumentDeleteResponse"]
export type SkillSuggestion = components["schemas"]["SkillSuggestionResponse"]

// The two lists this screen needs from config. Documents owns its own calls so
// nothing here reaches into another feature's api module.
export const LOOKUP_PATHS = {
  categories: "/api/v1/config/categories",
  skills: "/api/v1/config/skills",
} as const

export type LookupName = keyof typeof LOOKUP_PATHS

export type LookupRow = {
  id: string
  name: string
}

// Classes are not config, so they are not in LOOKUP_PATHS — but the documents
// screens need them to name and edit a document's assignment. Same key shape
// the classes module uses, so both share one cached copy.
export function listActiveClasses() {
  return api.get<LookupRow[]>("/api/v1/classes")
}

// Skills only exist inside a category, so the picker asks for one category's
// worth rather than filtering the whole list client-side.
export function listSkillsForCategory(categoryId: string) {
  return api.get<LookupRow[]>(
    `/api/v1/config/skills?category_id=${encodeURIComponent(categoryId)}`,
  )
}

// Read-only despite being a POST: it returns ids for the admin to confirm and
// writes nothing. Saving goes through updateDocument.
export function suggestSkills(id: string) {
  return api.post<SkillSuggestion>(`/api/v1/documents/${id}/suggest-skills`)
}

// Mirrors the server exactly: the endpoint gates on the multipart part's
// Content-Type (service.py MIME_EXT) — except for .md, which the server trusts
// by filename since browsers report its Content-Type inconsistently — and the
// document_versions CHECK constraint and the worker's extract_text allow the
// same three.
export const PDF_MIME = "application/pdf"
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
export const MD_MIME = "text/markdown"
export const ALLOWED_MIME_TYPES: string[] = [PDF_MIME, DOCX_MIME, MD_MIME]

// 20 * 1024 * 1024, matching MAX_FILE_SIZE in service.py. Using 20_000_000
// here would let a 20.5 MB file through the form and fail at the server.
export const MAX_FILE_SIZE = 20 * 1024 * 1024

export type DocumentFilters = {
  category_id?: string
  include_inactive?: boolean
  // What the exam-generation picker sends: only the documents assigned to the
  // class the exam is for.
  class_id?: string
}

export function listDocuments(filters: DocumentFilters) {
  const search = new URLSearchParams()
  if (filters.category_id !== undefined && filters.category_id !== "") {
    search.set("category_id", filters.category_id)
  }
  if (filters.include_inactive === true) search.set("include_inactive", "true")
  if (filters.class_id !== undefined && filters.class_id !== "") {
    search.set("class_id", filters.class_id)
  }
  const query = search.toString()
  return api.get<DocumentRow[]>(`/api/v1/documents${query === "" ? "" : `?${query}`}`)
}

export function getDocument(id: string) {
  return api.get<DocumentDetail>(`/api/v1/documents/${id}`)
}

export type UploadInput = {
  title: string
  category_id: string
  class_ids: string[]
  description: string
  change_note: string
  file: File
}

export function buildUploadForm(input: UploadInput): FormData {
  const form = new FormData()
  form.set("title", input.title)
  form.set("category_id", input.category_id)
  // Appended one per id, which is how FastAPI reads a list[UUID] off a form.
  for (const classId of input.class_ids) form.append("class_ids", classId)
  // Left off entirely when blank, so the column stays null rather than "".
  if (input.description !== "") form.set("description", input.description)
  if (input.change_note !== "") form.set("change_note", input.change_note)
  form.set("file", input.file)
  return form
}

export function uploadDocument(input: UploadInput) {
  return api.post<UploadResult>("/api/v1/documents/upload", buildUploadForm(input))
}

// PATCH, partial: fields left out keep their current value.
export function updateDocument(id: string, body: Record<string, unknown>) {
  return api.patch<DocumentDetail>(`/api/v1/documents/${id}`, body)
}

// Permanent. The server refuses with a 409 while an exam or a daily quiz
// config still points at it; that message is written for the admin and is
// shown as-is. A chat citation no longer blocks — it cascades instead.
export function deleteDocument(id: string) {
  return api.delete<DocumentDeleteResult>(`/api/v1/documents/${id}`)
}

export function promoteVersion(id: string, versionNumber: number) {
  return api.patch<DocumentRow>(`/api/v1/documents/${id}/versions/${versionNumber}/promote`)
}

export function reprocessVersion(id: string, versionNumber: number) {
  return api.post(`/api/v1/documents/${id}/versions/${versionNumber}/reprocess`)
}

export function setDocumentActive(id: string, active: boolean) {
  return api.patch<DocumentRow>(
    `/api/v1/documents/${id}/${active ? "activate" : "deactivate"}`,
  )
}

export function attachSkill(id: string, skillId: string) {
  return api.post<DocumentRow>(`/api/v1/documents/${id}/skills/${skillId}`)
}

export function detachSkill(id: string, skillId: string) {
  return api.delete<DocumentRow>(`/api/v1/documents/${id}/skills/${skillId}`)
}

export function listLookup(name: LookupName) {
  return api.get<LookupRow[]>(LOOKUP_PATHS[name])
}
