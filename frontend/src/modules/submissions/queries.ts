import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  getClass,
  getExercise,
  getSubmission,
  getUser,
  listClasses,
  listLearners,
  listSubmissions,
  overrideScore,
  type SubmissionFilters,
} from "@/modules/submissions/api"

export function useSubmissions(filters: SubmissionFilters) {
  return useQuery({
    queryKey: ["submissions", filters],
    queryFn: () => listSubmissions(filters),
  })
}

export function useSubmission(id: string) {
  return useQuery({
    queryKey: ["submission", id],
    queryFn: () => getSubmission(id),
  })
}

// id arrives asynchronously (looked up from the submission first), so this
// stays off until it has one, same as classes' useEnrollPreview gating.
export function useExercise(id: string | undefined) {
  return useQuery({
    queryKey: ["exercise", id],
    queryFn: () => getExercise(id as string),
    enabled: id !== undefined,
  })
}

// Shared with ClassesPage / ClassDetailPage's own list and detail queries, so
// this rides whatever either of those already cached.
export function useClasses() {
  return useQuery({
    queryKey: ["classes", { include_inactive: false }],
    queryFn: listClasses,
  })
}

export function useLearners() {
  return useQuery({
    queryKey: ["users", { role: "learner" }],
    queryFn: listLearners,
  })
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id as string),
    enabled: id !== undefined,
  })
}

export type ExerciseInfo = { exerciseId: string; title: string; classId: string; className: string }

// There is no global "list every exercise" endpoint, so each class's own
// exercises[] is fanned out and merged. Class counts are small in this
// product, and every fetch shares the ["class", id] key ClassDetailPage
// already uses, so this adds no extra network cost beyond what visiting each
// class page would already cause.
export function useExerciseDirectory(): { entries: ExerciseInfo[]; isPending: boolean } {
  const classes = useClasses()
  const classIds = (classes.data ?? []).map((row) => row.id)

  return useQueries({
    queries: classIds.map((id) => ({
      queryKey: ["class", id],
      queryFn: () => getClass(id),
    })),
    combine: (results) => ({
      isPending: classes.isPending || results.some((result) => result.isPending),
      entries: results.flatMap((result) =>
        result.data === undefined
          ? []
          : result.data.exercises.map((exercise) => ({
              exerciseId: exercise.id,
              title: exercise.title,
              classId: result.data!.id,
              className: result.data!.name,
            })),
      ),
    }),
  })
}

export function useOverrideScore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; score: number }) => overrideScore(input.id, input.score),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["submissions"] })
      queryClient.invalidateQueries({ queryKey: ["submission", input.id] })
    },
  })
}
