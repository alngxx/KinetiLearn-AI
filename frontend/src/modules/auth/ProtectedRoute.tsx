import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useAuth } from "@/modules/auth/useAuth"

export function ProtectedRoute() {
  const { user } = useAuth()
  const location = useLocation()

  if (user === null) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <Outlet />
}
