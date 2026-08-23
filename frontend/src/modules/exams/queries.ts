import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  deleteExercise,
  finalizeExercise,
  generateExercise,
  getExercise,
  listClasses,
  listDocuments,
  unpublishExercise,
  updateOption,
  updateQuestion,
  type Exercise,
  type FinalizeInput,
  type GenerateInput,
  type Question,
  type SaveStep,
} from "@/modules/exams/api"

// Deliberately no refetchInterval anywhere in this module. Generation is
// synchronous — POST /exams/generate returns the finished questions — so unlike
// documents there is no worker to wait on and nothing to poll.
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

export function useGenerateExercise() {
  return useExerciseMutation((input: GenerateInput) => generateExercise(input))
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
