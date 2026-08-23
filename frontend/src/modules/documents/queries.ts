import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  attachSkill,
  deleteDocument,
  detachSkill,
  getDocument,
  listDocuments,
  listLookup,
  promoteVersion,
  reprocessVersion,
  setDocumentActive,
  updateDocument,
  uploadDocument,
  type DocumentDetail,
  type DocumentFilters,
  type DocumentRow,
  type LookupName,
  type UploadInput,
} from "@/modules/documents/api"

export const POLL_INTERVAL_MS = 2000

// The pipeline settles on exactly one of these; everything else means a worker
// is still going to touch the row.
const TERMINAL_STATUSES = ["ready", "failed"]

// null means the document has no versions at all, so there is nothing a worker
// is going to change — it counts as settled, otherwise such a row would be
// polled forever.
export function isTerminal(status: string | null | undefined): boolean {
  return status === null || status === undefined || TERMINAL_STATUSES.includes(status)
}

// Returns false rather than a number once nothing is in flight, which is what
// makes React Query drop the timer instead of polling a settled document
// forever.
export function pollIntervalFor(statuses: (string | null | undefined)[]): number | false {
  return statuses.some((status) => !isTerminal(status)) ? POLL_INTERVAL_MS : false
}

// Same key shape the config and users screens use, so all three share one
// cached copy of each list.
const LOOKUP_KEYS: Record<LookupName, string> = {
  categories: "categories",
  skills: "skills",
}

const LOOKUP_NAMES = Object.keys(LOOKUP_KEYS) as LookupName[]

export function useDocuments(filters: DocumentFilters) {
  return useQuery({
    queryKey: ["documents", filters],
    queryFn: () => listDocuments(filters),
    refetchInterval: (query) =>
      pollIntervalFor(
        (query.state.data ?? []).map((row) => row.active_version_processing_status),
      ),
  })
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ["document", id],
    queryFn: () => getDocument(id),
    refetchInterval: (query) =>
      pollIntervalFor(
        (query.state.data?.versions ?? []).map((version) => version.processing_status),
      ),
  })
}

export function useDocumentLookups() {
  return useQueries({
    queries: LOOKUP_NAMES.map((name) => ({
      queryKey: ["config", LOOKUP_KEYS[name], { include_inactive: false }],
      queryFn: () => listLookup(name),
    })),
    combine: (results) => {
      const byName = {} as Record<LookupName, { id: string; name: string }[]>
      LOOKUP_NAMES.forEach((name, index) => {
        byName[name] = results[index].data ?? []
      })
      return byName
    },
  })
}

// Every mutation touches both the list and the detail view, so both are
// dropped rather than trying to patch two differently-shaped responses in.
function useDocumentMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] })
      queryClient.invalidateQueries({ queryKey: ["document"] })
    },
  })
}

export function useUploadDocument() {
  return useDocumentMutation((input: UploadInput) => uploadDocument(input))
}

export function usePromoteVersion() {
  return useDocumentMutation((input: { id: string; versionNumber: number }) =>
    promoteVersion(input.id, input.versionNumber),
  )
}

export function useReprocessVersion() {
  return useDocumentMutation((input: { id: string; versionNumber: number }) =>
    reprocessVersion(input.id, input.versionNumber),
  )
}

export function useSaveDocument() {
  return useDocumentMutation((input: { id: string; body: Record<string, unknown> }) =>
    updateDocument(input.id, input.body),
  )
}

export function useDeleteDocument() {
  return useDocumentMutation((input: { id: string }) => deleteDocument(input.id))
}

export function useSetDocumentActive() {
  return useDocumentMutation((input: { id: string; active: boolean }) =>
    setDocumentActive(input.id, input.active),
  )
}

export function useSetDocumentSkill() {
  return useDocumentMutation((input: { id: string; skillId: string; attached: boolean }) =>
    input.attached ? attachSkill(input.id, input.skillId) : detachSkill(input.id, input.skillId),
  )
}

export type { DocumentDetail, DocumentRow }
