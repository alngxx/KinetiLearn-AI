import { useContext } from "react"
import { AuthContext, type AuthState } from "@/modules/auth/AuthContext"

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (context === null) throw new Error("useAuth must be used inside AuthProvider")
  return context
}
