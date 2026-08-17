import { QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AdminLayout } from "@/layouts/AdminLayout"
import { LearnerLayout } from "@/layouts/LearnerLayout"
import { queryClient } from "@/lib/queryClient"
import { AuthProvider } from "@/modules/auth/AuthContext"
import { LoginPage } from "@/modules/auth/LoginPage"
import { ProtectedRoute } from "@/modules/auth/ProtectedRoute"
import { RoleRoute } from "@/modules/auth/RoleRoute"
import { homePathForRole } from "@/modules/auth/roles"
import { useAuth } from "@/modules/auth/useAuth"

function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={user === null ? "/login" : homePathForRole(user.role)} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />

            {/* Screens are added under these layouts in Task 34+. */}
            <Route element={<ProtectedRoute />}>
              <Route element={<RoleRoute role="admin" />}>
                <Route path="/admin" element={<AdminLayout />} />
              </Route>
              <Route element={<RoleRoute role="learner" />}>
                <Route path="/learner" element={<LearnerLayout />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
