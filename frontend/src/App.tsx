import { QueryClientProvider } from "@tanstack/react-query"
import { lazy, Suspense } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { LearnerLayout } from "@/layouts/LearnerLayout"
import { queryClient } from "@/lib/queryClient"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { LoginLandingPage } from "@/modules/auth/LoginLandingPage"
import { ProtectedRoute } from "@/modules/auth/ProtectedRoute"
import { RoleRoute } from "@/modules/auth/RoleRoute"
import { homePathForRole } from "@/modules/auth/roles"
import { useAuth } from "@/modules/auth/useAuth"
import { TakeQuizPage } from "@/modules/daily-quiz/TakeQuizPage"
import { ExamResultPage } from "@/modules/exams/ExamResultPage"
import { ExamTakePage } from "@/modules/exams/ExamTakePage"
import { LearnerClassPage } from "@/modules/learner-home/LearnerClassPage"
import { LearnerHomePage } from "@/modules/learner-home/LearnerHomePage"
import { LearnerSkillsPage } from "@/modules/learner-skills/LearnerSkillsPage"
import { ThemeProvider } from "@/modules/theme/ThemeContext"

// The whole admin console, split at the role gate rather than per screen. An
// admin pays for it once on first entry and then has every screen; a learner
// never pays at all. Splitting page-by-page would only add round trips for the
// admin without saving the learner anything more.
const AdminPortal = lazy(() =>
  import("@/AdminPortal").then((module) => ({ default: module.AdminPortal })),
)

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
              <Route path="/login" element={<LoginLandingPage />} />

              <Route element={<ProtectedRoute />}>
                <Route element={<RoleRoute role="admin" />}>
                  <Route
                    path="/admin/*"
                    element={
                      // The console has no shell until its chunk lands, so this
                      // fallback stands in for the whole page rather than for a
                      // pending query the way the learner one does.
                      <Suspense
                        fallback={
                          <p
                            role="status"
                            className="p-8 text-sm text-muted-foreground"
                          >
                            Loading…
                          </p>
                        }
                      >
                        <AdminPortal />
                      </Suspense>
                    }
                  />
                </Route>
                <Route element={<RoleRoute role="learner" />}>
                  <Route path="/learner" element={<LearnerLayout />}>
                    <Route index element={<LearnerHomePage />} />
                    <Route path="classes/:classId" element={<LearnerClassPage />} />
                    <Route path="skills" element={<LearnerSkillsPage />} />
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
