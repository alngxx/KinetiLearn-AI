import { useQueries, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createUser,
  listLookup,
  listUsers,
  setUserActive,
  updateUser,
  type LookupName,
  type UserFilters,
} from "@/modules/users/api"

// Same key shape the config pages use, so the two screens share one cached copy
// of each list.
const LOOKUP_KEYS: Record<LookupName, string> = {
  departments: "departments",
  seniority_levels: "seniority-levels",
  job_positions: "job-positions",
  employee_levels: "employee-levels",
}

const LOOKUP_NAMES = Object.keys(LOOKUP_KEYS) as LookupName[]

export function useUsers(filters: UserFilters) {
  return useQuery({
    queryKey: ["users", filters],
    queryFn: () => listUsers(filters),
    staleTime: 30_000,
  })
}

export function useUserLookups() {
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

export function useSaveUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id === undefined ? createUser(input.body) : updateUser(input.id, input.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })
}

export function useSetUserActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      setUserActive(input.id, input.active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
    },
  })
}
