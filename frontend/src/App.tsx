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
import { ConfigEntityPage } from "@/modules/config/ConfigEntityPage"
import { DocumentDetailPage } from "@/modules/documents/DocumentDetailPage"
import { DocumentsPage } from "@/modules/documents/DocumentsPage"
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
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="documents/:documentId" element={<DocumentDetailPage />} />
                    <Route path="config/:entityKey" element={<ConfigEntityPage />} />
                  </Route>
                </Route>
                {/* Learner screens land here in a later task. */}
                <Route element={<RoleRoute role="learner" />}>
                  <Route path="/learner" element={<LearnerLayout />} />
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
