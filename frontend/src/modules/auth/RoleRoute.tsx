import { Navigate, Outlet } from "react-router-dom"
import { homePathForRole } from "@/modules/auth/roles"
import { useAuth } from "@/modules/auth/useAuth"

// Navigational gating only — it decides what is offered, not what is allowed.
// The API enforces the real rules (require_admin and friends).
export function RoleRoute({ role }: { role: string }) {
  const { user } = useAuth()

  if (user === null) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to={homePathForRole(user.role)} replace />
  return <Outlet />
}
