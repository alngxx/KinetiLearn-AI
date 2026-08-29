import { useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/apiClient"
import { isApiError } from "@/lib/errors"
import { decodeToken } from "@/lib/tokenStorage"
import { homePathForRole } from "@/modules/auth/roles"
import { useAuth } from "@/modules/auth/useAuth"
import type { components } from "@/types/api"

type TokenResponse = components["schemas"]["TokenResponse"]

export function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      // skipAuthRedirect: a 401 here means the password is wrong, not that the
      // session expired, so it must stay on this page as a form error.
      const result = await api.post<TokenResponse>(
        "/api/v1/auth/login",
        { email, password },
        { skipAuthRedirect: true },
      )
      login(result.access_token)

      const claims = decodeToken(result.access_token)
      const next = searchParams.get("next")
      navigate(next ?? (claims === null ? "/" : homePathForRole(claims.role)), { replace: true })
    } catch (err) {
      setError(isApiError(err) ? err.message : "Something went wrong. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        {/* The same wordmark both shells lead with, so the product is named
            once here and the card can get on with its single job. */}
        <h1
          translate="no"
          className="text-center text-sm font-semibold tracking-tight text-foreground"
        >
          KinetiLearn
        </h1>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Use your work email address.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              {error !== null && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
