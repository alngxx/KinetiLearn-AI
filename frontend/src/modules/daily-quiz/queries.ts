import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  listTodayQuizzes,
  submitQuiz,
  type QuizQuestion,
  type QuizSubmitRequest,
  type TodayQuiz,
} from "@/modules/daily-quiz/api"

// The home page and the take page share this key, so arriving from home serves
// the cache and a reload or a pasted link refetches. There is no GET /quiz/{id}
// to fetch a single quiz with.
export function useTodayQuizzes() {
  return useQuery({
    queryKey: ["quiz", "today"],
    queryFn: listTodayQuizzes,
  })
}

export function useSubmitQuiz() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: QuizSubmitRequest) => submitQuiz(body),
    // The quiz that was just answered now comes back already_submitted, which
    // is what flips the home card and closes the take page.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["quiz", "today"] }),
  })
}

export type { QuizQuestion, TodayQuiz }
