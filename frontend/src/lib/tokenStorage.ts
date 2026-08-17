// The backend has no refresh endpoint, so the access token is the whole session.
// It is kept in localStorage: an accepted MVP limitation, not a security choice.

const TOKEN_KEY = "kinetilearn_token"

// Exactly what app/core/security.py signs: {"sub", "role", "exp"}.
export type TokenClaims = {
  sub: string
  role: string
  exp: number
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

// Reads the payload without verifying the signature — a client cannot verify it
// and must never try. Used only to skip requests that are certain to 401.
export function decodeToken(token: string): TokenClaims | null {
  const parts = token.split(".")
  if (parts.length !== 3) return null

  try {
    // base64url, and JWTs drop the padding that atob wants back.
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const payload = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))
    const claims = JSON.parse(payload)
    if (
      typeof claims.sub !== "string" ||
      typeof claims.role !== "string" ||
      typeof claims.exp !== "number"
    ) {
      return null
    }
    return { sub: claims.sub, role: claims.role, exp: claims.exp }
  } catch {
    return null
  }
}

// exp is in seconds, Date.now() in milliseconds.
export function isExpired(claims: TokenClaims, nowMs: number = Date.now()): boolean {
  return claims.exp * 1000 <= nowMs
}
