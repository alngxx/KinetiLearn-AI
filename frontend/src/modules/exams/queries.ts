import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import {
  deleteExercise,
  finalizeExercise,
  generateExercise,
  getExercise,
  getGenerationJob,
  listClasses,
  listDocuments,
  unpublishExercise,
  updateExercise,
  updateOption,
  updateQuestion,
  type Exercise,
  type ExerciseUpdateInput,
  type FinalizeInput,
  type GenerateInput,
  type GenerationJob,
  type Question,
  type SaveStep,
} from "@/modules/exams/api"

export const JOB_POLL_INTERVAL_MS = 2000

// A generation job settles on exactly one of these; anything else means the
// worker still has it.
const TERMINAL_STATUSES = ["succeeded", "failed"]

// undefined covers the job not being loaded yet, which must not read as settled —
// that would drop the timer before the first response arrives.
export function isTerminal(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && TERMINAL_STATUSES.includes(status)
}

// Returns false rather than a number once the job has settled, which is what
// makes React Query drop the timer instead of polling a finished job forever.
// Same shape as the documents module's version; each module owns its own
// queries here rather than reaching into another feature's.
export function pollIntervalFor(status: string | null | undefined): number | false {
  return isTerminal(status) ? false : JOB_POLL_INTERVAL_MS
}

// Generation runs in the Celery worker, so the waiting page polls the job until
// it lands on succeeded or failed. Disabled when there is no job to watch.
export function useGenerationJob(jobId: string | null) {
  return useQuery({
    queryKey: ["exam-generation-job", jobId],
    queryFn: () => getGenerationJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) => pollIntervalFor(query.state.data?.status),
  })
}

export function useExercise(id: string) {
  return useQuery({
    queryKey: ["exercise", id],
    queryFn: () => getExercise(id),
  })
}

// Both lists the generate form needs. Exams owns its own calls so nothing here
// reaches into another feature's api module.
export function useExamLookups() {
  return useQueries({
    queries: [
      { queryKey: ["documents", {}], queryFn: () => listDocuments() },
      { queryKey: ["classes", { include_inactive: false }], queryFn: () => listClasses() },
    ],
    combine: (results) => ({
      documents: results[0].data ?? [],
      classes: results[1].data ?? [],
      isPending: results.some((result) => result.isPending),
    }),
  })
}

// A new or finalized exercise changes the class's exercises table, so the class
// detail and list queries are dropped alongside the exercise itself.
function useExerciseMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exercise"] })
      queryClient.invalidateQueries({ queryKey: ["class"] })
      queryClient.invalidateQueries({ queryKey: ["classes"] })
    },
  })
}

// Not a useExerciseMutation: accepting a job changes no exercise and no class, so
// there is nothing to invalidate yet. useExerciseCreated below does that once the
// job actually lands.
export function useGenerateExercise() {
  return useMutation({
    mutationFn: (input: GenerateInput) => generateExercise(input),
  })
}

// Called when a generation job reports success — the new draft has to appear on
// the class page the admin came from.
export function useExerciseCreated() {
  const queryClient = useQueryClient()
  // Stable so the caller can depend on it from an effect without re-firing.
  return useCallback(
    (job: GenerationJob) => {
      queryClient.invalidateQueries({ queryKey: ["exercise"] })
      queryClient.invalidateQueries({ queryKey: ["class"] })
      queryClient.invalidateQueries({ queryKey: ["classes"] })
      return job
    },
    [queryClient],
  )
}

export function useUpdateExercise() {
  return useExerciseMutation((input: { id: string; body: ExerciseUpdateInput }) =>
    updateExercise(input.id, input.body),
  )
}

export function useFinalizeExercise() {
  return useExerciseMutation((input: { id: string; body: FinalizeInput }) =>
    finalizeExercise(input.id, input.body),
  )
}

export function useDeleteExercise() {
  return useExerciseMutation((input: { id: string }) => deleteExercise(input.id))
}

export function useUnpublishExercise() {
  return useExerciseMutation((input: { id: string }) => unpublishExercise(input.id))
}

// Runs one step of a question save and writes the returned question straight
// back into the cached exercise. Every question write returns the whole fresh
// question, so the card can resync its baseline from what actually persisted
// rather than assuming the write matched what it sent.
export function useQuestionStepRunner(exerciseId: string) {
  const queryClient = useQueryClient()

  return async function runStep(questionId: string, step: SaveStep): Promise<Question> {
    const fresh =
      step.kind === "details"
        ? await updateQuestion(questionId, step.body)
        : await updateOption(questionId, step.optionId, step.body)

    queryClient.setQueryData<Exercise>(["exercise", exerciseId], (current) =>
      current === undefined
        ? current
        : {
            ...current,
            questions: current.questions.map((question) =>
              question.id === fresh.id ? fresh : question,
            ),
          },
    )
    return fresh
  }
}
