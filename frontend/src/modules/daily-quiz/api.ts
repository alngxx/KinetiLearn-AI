import { api } from "@/lib/apiClient"
import type { components } from "@/types/api"

export type TodayQuiz = components["schemas"]["DailyQuizTodayResponse"]
export type QuizQuestion = components["schemas"]["DailyQuizQuestionOut"]
export type QuizSubmitRequest = components["schemas"]["DailyQuizSubmitRequest"]
export type QuizSubmission = components["schemas"]["DailyQuizSubmissionDetailResponse"]

// Returns every quiz that has not expired yet and matches the caller's audience,
// not just today's — expiry is expiry_hours after generation, so several can be
// live at once. Already-answered ones are included, flagged already_submitted.
export function listTodayQuizzes() {
  return api.get<TodayQuiz[]>("/api/v1/quiz/today")
}

export function submitQuiz(body: QuizSubmitRequest) {
  return api.post<QuizSubmission>("/api/v1/quiz/submissions", body)
}
