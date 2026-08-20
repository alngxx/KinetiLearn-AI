import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createEntity,
  listEntities,
  setEntityActive,
  updateEntity,
  type ConfigRow,
  type ListParams,
} from "@/modules/config/api"
import type { ConfigEntityDescriptor, LookupKey } from "@/modules/config/descriptors"

const LOOKUP_PATHS: Record<LookupKey, string> = {
  categories: "/api/v1/config/categories",
}

export function useConfigList(descriptor: ConfigEntityDescriptor, params: ListParams) {
  return useQuery({
    queryKey: ["config", descriptor.key, params],
    queryFn: () => listEntities(descriptor.basePath, params),
  })
}

// Active-only, and shared with any other screen asking for the same list.
export function useLookup(key: LookupKey | null) {
  return useQuery({
    queryKey: ["config", key, { include_inactive: false }],
    queryFn: () => listEntities(LOOKUP_PATHS[key as LookupKey], {}),
    enabled: key !== null,
  })
}

export function useSaveEntity(descriptor: ConfigEntityDescriptor) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id === undefined
        ? createEntity(descriptor.basePath, input.body)
        : updateEntity(descriptor.basePath, input.id, input.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config", descriptor.key] })
    },
  })
}

export function useSetActive(descriptor: ConfigEntityDescriptor) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { row: ConfigRow; active: boolean }) =>
      setEntityActive(descriptor.basePath, input.row.id, input.active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config", descriptor.key] })
    },
  })
}
