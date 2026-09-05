import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createConfig,
  deleteConfig,
  listConfigs,
  listDocuments,
  listLookup,
  setConfigActive,
  updateConfig,
  type LookupName,
} from "@/modules/daily-quiz-configs/api"

// Same key shape config, users and classes screens use, so a lookup fetched
// from any of them is shared here too.
const LOOKUP_KEYS: Record<LookupName, string> = {
  departments: "departments",
  seniority_levels: "seniority-levels",
  job_positions: "job-positions",
  employee_levels: "employee-levels",
}

const LOOKUP_NAMES = Object.keys(LOOKUP_KEYS) as LookupName[]

export function useDailyQuizConfigs(includeInactive: boolean) {
  return useQuery({
    queryKey: ["daily-quiz-configs", { include_inactive: includeInactive }],
    queryFn: () => listConfigs(includeInactive),
  })
}

export function useTargetLookups() {
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

export function useEligibleDocuments() {
  return useQuery({
    queryKey: ["documents", { include_inactive: false }],
    queryFn: listDocuments,
  })
}

function useConfigMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-quiz-configs"] })
    },
  })
}

export function useSaveConfig() {
  return useConfigMutation((input: { id?: string; body: Record<string, unknown> }) =>
    input.id === undefined ? createConfig(input.body) : updateConfig(input.id, input.body),
  )
}

export function useSetConfigActive() {
  return useConfigMutation((input: { id: string; active: boolean }) =>
    setConfigActive(input.id, input.active),
  )
}

export function useDeleteConfig() {
  return useConfigMutation((input: { id: string }) => deleteConfig(input.id))
}
