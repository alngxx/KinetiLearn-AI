import { QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { AdminLayout } from "@/layouts/AdminLayout"
import { LearnerLayout } from "@/layouts/LearnerLayout"
import { queryClient } from "@/lib/queryClient"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { LoginPage } from "@/modules/auth/LoginPage"
import { ProtectedRoute } from "@/modules/auth/ProtectedRoute"
import { RoleRoute } from "@/modules/auth/RoleRoute"
import { homePathForRole } from "@/modules/auth/roles"
import { useAuth } from "@/modules/auth/useAuth"
import { ClassDetailPage } from "@/modules/classes/ClassDetailPage"
import { ClassesPage } from "@/modules/classes/ClassesPage"
import { ConfigEntityPage } from "@/modules/config/ConfigEntityPage"
import { TakeQuizPage } from "@/modules/daily-quiz/TakeQuizPage"
import { DailyQuizConfigsPage } from "@/modules/daily-quiz-configs/DailyQuizConfigsPage"
import { DocumentDetailPage } from "@/modules/documents/DocumentDetailPage"
import { DocumentsPage } from "@/modules/documents/DocumentsPage"
import { ExamResultPage } from "@/modules/exams/ExamResultPage"
import { ExamTakePage } from "@/modules/exams/ExamTakePage"
import { ExerciseDetailPage } from "@/modules/exams/ExerciseDetailPage"
import { GenerateExamPage } from "@/modules/exams/GenerateExamPage"
import { LearnerClassPage } from "@/modules/learner-home/LearnerClassPage"
import { LearnerHomePage } from "@/modules/learner-home/LearnerHomePage"
import { UserSkillsPage } from "@/modules/scoring/UserSkillsPage"
import { SubmissionDetailPage } from "@/modules/submissions/SubmissionDetailPage"
import { SubmissionsPage } from "@/modules/submissions/SubmissionsPage"
import { ThemeProvider } from "@/modules/theme/ThemeContext"
import { UsersPage } from "@/modules/users/UsersPage"

function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={user === null ? "/login" : homePathForRole(user.role)} replace />
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/login" element={<LoginPage />} />

              <Route element={<ProtectedRoute />}>
                <Route element={<RoleRoute role="admin" />}>
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<Navigate to="/admin/users" replace />} />
                    <Route path="users" element={<UsersPage />} />
                    <Route path="classes" element={<ClassesPage />} />
                    <Route path="classes/:classId" element={<ClassDetailPage />} />
                    {/* An exercise belongs to a class and there is no global
                        exam list to reach one from, so both live under it. */}
                    <Route
                      path="classes/:classId/exercises/new"
                      element={<GenerateExamPage />}
                    />
                    <Route
                      path="classes/:classId/exercises/:exerciseId"
                      element={<ExerciseDetailPage />}
                    />
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="documents/:documentId" element={<DocumentDetailPage />} />
                    <Route path="config/:entityKey" element={<ConfigEntityPage />} />
                    <Route path="daily-quizzes" element={<DailyQuizConfigsPage />} />
                    <Route path="submissions" element={<SubmissionsPage />} />
                    <Route path="submissions/:submissionId" element={<SubmissionDetailPage />} />
                    <Route path="users/:userId/skills" element={<UserSkillsPage />} />
                  </Route>
                </Route>
                <Route element={<RoleRoute role="learner" />}>
                  <Route path="/learner" element={<LearnerLayout />}>
                    <Route index element={<LearnerHomePage />} />
                    <Route path="classes/:classId" element={<LearnerClassPage />} />
                    <Route path="quiz/:quizId" element={<TakeQuizPage />} />
                    <Route path="exams/:exerciseId/take" element={<ExamTakePage />} />
                    <Route
                      path="exams/:exerciseId/result/:submissionId"
                      element={<ExamResultPage />}
                    />
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <Toaster />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
