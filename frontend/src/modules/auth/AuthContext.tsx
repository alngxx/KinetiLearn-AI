import { createContext, useCallback, useMemo, useState, type ReactNode } from "react"
import { queryClient } from "@/lib/queryClient"
import { clearToken, decodeToken, getToken, isExpired, setToken } from "@/lib/tokenStorage"

export type AuthUser = {
  id: string
  role: string
}

export type AuthState = {
  user: AuthUser | null
  token: string | null
  login: (token: string) => void
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

// Reads the stored token on boot and drops it when it is unreadable or already
// expired. This is a UX shortcut that avoids a request certain to 401 — never a
// security check. The backend remains the only thing that validates a token.
export function readStoredToken(): string | null {
  const token = getToken()
  if (token === null) return null

  const claims = decodeToken(token)
  if (claims === null || isExpired(claims)) {
    clearToken()
    return null
  }
  return token
}

// The role claim drives which menus and routes are offered. Every endpoint still
// enforces its own access rules server-side.
export function userFromToken(token: string | null): AuthUser | null {
  if (token === null) return null
  const claims = decodeToken(token)
  return claims === null ? null : { id: claims.sub, role: claims.role }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(readStoredToken)

  const login = useCallback((next: string) => {
    setToken(next)
    setTokenState(next)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    queryClient.clear()
    setTokenState(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ token, user: userFromToken(token), login, logout }),
    [token, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
