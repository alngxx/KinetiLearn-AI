import { useQueries, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createUser,
  getMe,
  listLookup,
  listUsers,
  removeAvatar,
  setUserActive,
  updateUser,
  uploadAvatar,
  type LookupName,
  type UserFilters,
  type UserRow,
} from "@/modules/users/api"
import { useAuth } from "@/modules/auth/useAuth"

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

// The signed avatar URL is regenerated on every call, so a background refetch
// would hand the <img> a new src and make it re-download a picture it already
// has. Nothing else about the signed-in user changes mid-session, so this is
// fetched once and updated only by the two mutations below.
//
// Keyed on the signed-in user's own id, not just "me": staleTime: Infinity
// means react-query will happily hand back a cached entry forever without
// ever refetching it, and login() does not clear the cache (only logout()
// does). Scoping the key by id means signing in as someone else always lands
// on a fresh cache entry instead of briefly showing the previous account's
// name and avatar. Disabled with no user so it never fires (and never
// caches) for a signed-out visitor.
export function useMe() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ["me", user?.id],
    queryFn: getMe,
    enabled: user !== null,
    staleTime: Infinity,
  })
}

export function useSetAvatar() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadAvatar(file),
    // Must match useMe's own key exactly, or this writes to a cache entry
    // nothing reads and the avatar only appears after some later refetch that
    // staleTime: Infinity ensures never happens on its own.
    onSuccess: (updated: UserRow) => {
      queryClient.setQueryData(["me", user?.id], updated)
    },
  })
}

export function useRemoveAvatar() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: removeAvatar,
    onSuccess: (updated: UserRow) => {
      queryClient.setQueryData(["me", user?.id], updated)
    },
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
