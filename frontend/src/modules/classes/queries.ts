import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  bulkAddMembers,
  countEnrollMatches,
  createClass,
  getClass,
  hasEnrollFilter,
  listClasses,
  listLookup,
  setClassActive,
  updateClass,
  type ClassDetail,
  type ClassRow,
  type EnrollFilters,
  type LookupName,
} from "@/modules/classes/api"

// Same key shape the config, users and documents screens use, so all of them
// share one cached copy of each list.
const LOOKUP_KEYS: Record<LookupName, string> = {
  departments: "departments",
  seniority_levels: "seniority-levels",
  employee_levels: "employee-levels",
}

const LOOKUP_NAMES = Object.keys(LOOKUP_KEYS) as LookupName[]

export function useClasses(includeInactive: boolean) {
  return useQuery({
    queryKey: ["classes", { include_inactive: includeInactive }],
    queryFn: () => listClasses(includeInactive),
  })
}

export function useClass(id: string) {
  return useQuery({
    queryKey: ["class", id],
    queryFn: () => getClass(id),
  })
}

export function useClassLookups() {
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

// Bulk enrolment writes immediately and there is no way to remove a member
// again, so the dialog counts the audience first. Stays off until a filter is
// set, matching the rule the server enforces.
export function useEnrollPreview(filters: EnrollFilters) {
  return useQuery({
    queryKey: ["enroll-preview", filters],
    queryFn: () => countEnrollMatches(filters),
    enabled: hasEnrollFilter(filters),
  })
}

// Every mutation touches both the list and the detail view, so both are dropped
// rather than trying to patch two differently-shaped responses in.
function useClassMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["classes"] })
      queryClient.invalidateQueries({ queryKey: ["class"] })
    },
  })
}

export function useSaveClass() {
  return useClassMutation((input: { id?: string; body: Record<string, unknown> }) =>
    input.id === undefined ? createClass(input.body) : updateClass(input.id, input.body),
  )
}

export function useSetClassActive() {
  return useClassMutation((input: { id: string; active: boolean }) =>
    setClassActive(input.id, input.active),
  )
}

export function useBulkAddMembers() {
  return useClassMutation((input: { id: string; filters: EnrollFilters }) =>
    bulkAddMembers(input.id, input.filters),
  )
}

export type { ClassDetail, ClassRow }
