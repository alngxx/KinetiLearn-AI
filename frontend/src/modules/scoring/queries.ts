import { useQuery } from "@tanstack/react-query"
import { getMySkillBreakdown, getSkillBreakdown, getUser } from "@/modules/scoring/api"

export function useSkillBreakdown(userId: string) {
  return useQuery({
    queryKey: ["skill-breakdown", userId],
    queryFn: () => getSkillBreakdown(userId),
  })
}

export function useMySkillBreakdown() {
  return useQuery({
    queryKey: ["my-skill-breakdown"],
    queryFn: getMySkillBreakdown,
  })
}

export function useUser(userId: string) {
  return useQuery({
    queryKey: ["user", userId],
    queryFn: () => getUser(userId),
  })
}
