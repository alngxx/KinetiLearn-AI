import { Navigate, Route, Routes } from "react-router-dom"
import { AdminLayout } from "@/layouts/AdminLayout"
import { ClassDetailPage } from "@/modules/classes/ClassDetailPage"
import { ClassesPage } from "@/modules/classes/ClassesPage"
import { ConfigEntityPage } from "@/modules/config/ConfigEntityPage"
import { DailyQuizConfigsPage } from "@/modules/daily-quiz-configs/DailyQuizConfigsPage"
import { DocumentDetailPage } from "@/modules/documents/DocumentDetailPage"
import { DocumentsPage } from "@/modules/documents/DocumentsPage"
import { ExerciseDetailPage } from "@/modules/exams/ExerciseDetailPage"
import { GenerateExamPage } from "@/modules/exams/GenerateExamPage"
import { UserSkillsPage } from "@/modules/scoring/UserSkillsPage"
import { SubmissionDetailPage } from "@/modules/submissions/SubmissionDetailPage"
import { SubmissionsPage } from "@/modules/submissions/SubmissionsPage"
import { UsersPage } from "@/modules/users/UsersPage"

// Every admin screen, behind one import. App.tsx mounts this lazily under the
// admin role gate, so a learner never downloads the console — including the
// Radix menu tree the row actions pull in, which is admin-only and the single
// largest thing in here.
//
// Paths are relative to the /admin/* splat in App.tsx, and AdminLayout is a
// pathless layout route so it still owns the Outlet for all of them.
export function AdminPortal() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="classes" element={<ClassesPage />} />
        <Route path="classes/:classId" element={<ClassDetailPage />} />
        {/* An exercise belongs to a class and there is no global exam list to
            reach one from, so both live under it. */}
        <Route path="classes/:classId/exercises/new" element={<GenerateExamPage />} />
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
    </Routes>
  )
}
