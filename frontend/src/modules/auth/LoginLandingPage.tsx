import { useEffect, useRef, useState, type FormEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/apiClient"
import { isApiError } from "@/lib/errors"
import { decodeToken } from "@/lib/tokenStorage"
import { LoginStarfield } from "@/modules/auth/LoginStarfield"
import { homePathForRole } from "@/modules/auth/roles"
import { useAuth } from "@/modules/auth/useAuth"
import { useTheme } from "@/modules/theme/useTheme"
import type { components } from "@/types/api"

type TokenResponse = components["schemas"]["TokenResponse"]

// Which door was clicked. This is presentation only: it picks the welcome copy
// and the accent on the submit button, nothing else. Both doors post the same
// credentials to the same endpoint, and the role that comes back in the token
// is the backend's answer, not this one - a learner who opens ?door=admin still
// lands in the learner portal.
type Door = "admin" | "learner"

const DOORS = {
  admin: {
    eyebrow: "Administration",
    heading: "Managers",
    blurb: ["Build exams, assign courses,", "follow completion across every team."],
    cta: "Log in as admins",
    welcome: "Sign in to continue your management.",
  },
  learner: {
    eyebrow: "Learning",
    heading: "Employees",
    blurb: ["Open your assigned training,", "take daily quiz, and chat with our AI."],
    cta: "Log in as learners",
    welcome: "Sign in to continue your assigned training.",
  },
} as const satisfies Record<Door, unknown>

// Both accents are fixed brand hex, identical in light and dark, so they are
// spelled once here rather than in each of the six places they appear.
const ACCENT = {
  admin: {
    dot: "bg-kl-emerald shadow-[0_0_8px_rgba(16,185,129,0.8)]",
    solid:
      "border-[rgba(16,185,129,0.85)] bg-kl-emerald text-[#04140c] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_0_4px_rgba(16,185,129,0.18),0_10px_26px_-12px_rgba(16,185,129,0.85)] focus-visible:outline-kl-emerald",
  },
  learner: {
    dot: "bg-kl-cyan shadow-[0_0_8px_rgba(6,182,212,0.8)]",
    solid:
      "border-[rgba(6,182,212,0.85)] bg-kl-cyan text-[#04171c] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_0_4px_rgba(6,182,212,0.18),0_10px_26px_-12px_rgba(6,182,212,0.85)] focus-visible:outline-kl-cyan",
  },
} as const satisfies Record<Door, unknown>

const MICRO_CAPS = "font-mono font-medium tracking-[0.16em] text-kl-dim uppercase"
const SOLID_BUTTON =
  "touch-manipulation rounded-[5px] border px-[22px] py-[11px] text-sm font-[650] tracking-[-0.01em] whitespace-nowrap shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition-[box-shadow,transform] duration-200 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2"

function isDoor(value: string | null): value is Door {
  return value === "admin" || value === "learner"
}

// One vertical bar and two blades cut from a single tile: white tile with a
// slate glyph in light, obsidian tile with a platinum glyph in dark.
function BrandMark() {
  const blade = "bg-[image:linear-gradient(160deg,var(--kl-glyph),var(--kl-glyph-2))]"

  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="relative inline-flex size-[34px] items-center justify-center rounded-[7px] border border-kl-tile-line bg-kl-tile shadow-[var(--kl-tile-shadow)]"
        style={{ animation: "kl-kinetic 4.4s ease-in-out infinite" }}
      >
        <span className={`absolute top-[9px] left-[10px] h-4 w-[2.5px] ${blade}`} />
        <span
          className={`absolute top-[9px] left-[14px] h-[7.5px] w-2 ${blade}`}
          style={{ clipPath: "polygon(100% 0,100% 32%,0 100%,0 62%)" }}
        />
        <span
          className={`absolute top-[17.5px] left-[14px] h-[7.5px] w-2 ${blade}`}
          style={{ clipPath: "polygon(0 0,0 38%,100% 100%,100% 68%)" }}
        />
      </span>
      <span translate="no" className="text-xl font-bold tracking-[-0.035em] text-kl-wordmark">
        KinetiLearn
      </span>
    </span>
  )
}

// The landing's switch is binary, but it writes into the same ThemeContext the
// portals read, so flipping it here is a real app-wide theme change rather than
// a local preview. "system" resolves to whatever the system currently is and
// the switch then commits the opposite, which is all one control can mean.
function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme()
  const next = resolvedTheme === "dark" ? "light" : "dark"

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className={`inline-flex touch-manipulation items-center gap-2 rounded-[5px] border border-kl-rule bg-kl-panel px-[11px] py-1.5 text-[10.5px] tracking-[0.13em] backdrop-blur-[6px] transition-colors hover:border-kl-emerald hover:text-kl-fg focus-visible:border-kl-emerald focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kl-emerald ${MICRO_CAPS}`}
    >
      {/* The identity indigo, matching the learner shell's "Ask Pace" dot,
          rather than the admin/learner door accents — this switch isn't tied
          to either door. Same "live-looking, not live" idiom as the door
          eyebrow dots below: a ring pulses behind a steady centre. */}
      <span aria-hidden="true" className="relative inline-flex size-2">
        <span
          className="absolute inset-0 rounded-full bg-ring"
          style={{ animation: "kl-ping 1.8s cubic-bezier(0,0,.2,1) infinite" }}
        />
        <span
          className="relative size-2 rounded-full bg-ring shadow-[0_0_8px_color-mix(in_oklab,var(--ring)_80%,transparent)]"
          style={{ animation: "kl-pulse 1.8s ease-in-out infinite" }}
        />
      </span>
      {resolvedTheme === "dark" ? "Dark" : "Light"}
      <span className="sr-only">theme, switch to {next}</span>
    </button>
  )
}

function DoorPanel({ door, onOpen }: { door: Door; onOpen: (door: Door) => void }) {
  const { eyebrow, heading, blurb, cta } = DOORS[door]
  const isAdmin = door === "admin"

  return (
    <section
      data-kl-door={door}
      className={`flex flex-col items-center gap-[18px] px-10 py-[62px] text-center backdrop-blur-[24px] ${
        isAdmin
          ? "rounded-l-[6px] border border-r-0 border-kl-mgr-border border-t-kl-mgr-top bg-[image:var(--kl-mgr-bg)] max-[820px]:rounded-r-[6px] max-[820px]:border-r"
          : "rounded-r-[6px] border border-l-0 border-kl-lrn-border border-t-kl-lrn-top bg-[image:var(--kl-lrn-bg)] max-[820px]:rounded-l-[6px] max-[820px]:border-l"
      }`}
    >
      <span className={`inline-flex items-center gap-2 text-xs ${MICRO_CAPS}`}>
        {/* Live-looking, not live: the ring expands behind a steady dot so the
            door reads as an open channel rather than as a pending status. */}
        <span aria-hidden="true" className="relative inline-flex size-1.5">
          <span
            className={`absolute inset-0 rounded-full ${isAdmin ? "bg-kl-emerald" : "bg-kl-cyan"}`}
            style={{ animation: "kl-ping 1.8s cubic-bezier(0,0,.2,1) infinite" }}
          />
          <span
            className={`relative size-1.5 rounded-full ${ACCENT[door].dot}`}
            style={{ animation: "kl-pulse 1.8s ease-in-out infinite" }}
          />
        </span>
        {eyebrow}
      </span>

      <h2 className="text-[40px]/[1.08] font-extrabold tracking-[-0.032em]">{heading}</h2>

      <p className="max-w-[33ch] text-sm/[1.6] text-pretty text-kl-dim">
        {blurb[0]}
        <br />
        {blurb[1]}
      </p>

      <button
        type="button"
        onClick={() => onOpen(door)}
        className={`mt-3.5 ${SOLID_BUTTON} ${ACCENT[door].solid}`}
      >
        {cta}
      </button>
    </section>
  )
}

export function LoginLandingPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const doorParam = searchParams.get("door")
  const door: Door | null = isDoor(doorParam) ? doorParam : null

  // The form replaces the doors rather than appearing below them, so nothing
  // marks the change for a keyboard or a screen reader unless focus follows it.
  // The heading rather than the first field: it names the view that just
  // arrived, and it does not raise a keyboard on a phone.
  useEffect(() => {
    if (door !== null) headingRef.current?.focus()
  }, [door])

  function setDoor(next: Door | null) {
    const params = new URLSearchParams(searchParams)
    if (next === null) params.delete("door")
    else params.set("door", next)
    // replace, so the doors and the form are one stop in history and ?next=
    // survives the trip either way.
    setSearchParams(params, { replace: true })
    setError(null)
  }

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

      // Destination comes from the token's role claim, never from the door.
      const claims = decodeToken(result.access_token)
      const next = searchParams.get("next")
      navigate(next ?? (claims === null ? "/" : homePathForRole(claims.role)), { replace: true })
    } catch (err) {
      setError(isApiError(err) ? err.message : "Something went wrong. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <div
      data-kl-landing=""
      className="relative flex min-h-svh flex-col overflow-hidden bg-[image:var(--kl-page-bg)] font-sans text-kl-fg transition-colors duration-[400ms]"
    >
      <LoginStarfield />

      {/* Aurora: emerald overhead, cyan underfoot, a violet nebula between. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[image:var(--kl-corner)]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 right-[-10%] left-[-10%] h-[280px] bg-[image:var(--kl-banner-top)] blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 right-[-10%] left-[-10%] h-[240px] bg-[image:var(--kl-banner-bot)] blur-[100px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[image:var(--kl-nebula)] blur-[60px]"
      />

      <header className="relative flex items-center justify-between gap-6 border-b border-kl-rule px-10 py-[22px] max-[820px]:px-6">
        <BrandMark />
        <ThemeSwitch />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-6 pt-8 pb-14">
        {door === null ? (
          <>
            {/* The panel headings are the page's two choices, not its subject,
                so they stay h2 and the subject is named once above them. */}
            <h1 className="sr-only">Choose how you sign in</h1>
            <div
              data-kl-doors=""
              className="grid w-full max-w-[1180px] grid-cols-[1fr_1px_1fr] items-stretch max-[820px]:grid-cols-1"
            >
              <DoorPanel door="admin" onOpen={setDoor} />
              <div
                aria-hidden="true"
                className="w-px bg-kl-rule max-[820px]:h-px max-[820px]:w-full"
              />
              <DoorPanel door="learner" onOpen={setDoor} />
            </div>
          </>
        ) : (
          <div
            className="flex w-full max-w-[404px] flex-col gap-4"
            style={{ animation: "kl-rise .32s ease both" }}
          >
            <button
              type="button"
              onClick={() => setDoor(null)}
              className={`self-start touch-manipulation rounded-[5px] py-1 text-[10.5px] tracking-[0.13em] transition-colors hover:text-kl-emerald focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kl-emerald ${MICRO_CAPS}`}
            >
              Back
            </button>

            <div className="flex flex-col gap-[22px] rounded-[6px] border border-kl-card-line bg-kl-card p-[30px] shadow-[inset_0_1px_0_var(--kl-edge),0_18px_44px_-24px_rgba(2,6,12,0.55)] backdrop-blur-[14px]">
              <div className="flex flex-col gap-2">
                <span className={`inline-flex items-center gap-2 text-[11px] ${MICRO_CAPS}`}>
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${ACCENT[door].dot}`}
                  />
                  {DOORS[door].heading}
                </span>
                {/* tabIndex -1 makes this a focus target, not a tab stop, so
                    the ring would only ever appear on the programmatic focus
                    above and never mark a place a keyboard can reach. */}
                <h1
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-[25px]/[1.16] font-extrabold tracking-[-0.028em] outline-none"
                >
                  Welcome back
                </h1>
                <p className="text-[13.5px]/[1.6] text-kl-dim">{DOORS[door].welcome}</p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-[7px]">
                  <Label htmlFor="email" className="text-[12.5px] font-medium">
                    Email
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder="you@company.com"
                    spellCheck={false}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    className="h-9 border-kl-card-line bg-kl-panel text-sm dark:bg-kl-panel"
                  />
                </div>
                <div className="flex flex-col gap-[7px]">
                  <Label htmlFor="password" className="text-[12.5px] font-medium">
                    Password
                  </Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    className="h-9 border-kl-card-line bg-kl-panel text-sm dark:bg-kl-panel"
                  />
                </div>

                {/* Coloured to the door that was chosen, so the lens the user
                    picked stays visible right up to the moment they sign in. */}
                <button
                  type="submit"
                  disabled={submitting}
                  className={`mt-0.5 w-full ${SOLID_BUTTON} ${ACCENT[door].solid} disabled:pointer-events-none disabled:opacity-60`}
                >
                  {submitting ? "Signing in…" : "Sign in"}
                </button>

                {error !== null && (
                  <p role="alert" className="font-mono text-[11px] tracking-[0.02em] text-kl-dim">
                    {error}
                  </p>
                )}
              </form>

              <div className="border-t border-kl-rule pt-4 text-xs/[1.6] text-pretty text-kl-dim">
                <button
                  type="button"
                  onClick={() => alert("Password reset functionality is for demonstration purposes only.")}
                  className="cursor-pointer transition-colors hover:text-kl-fg focus-visible:outline-none"
                >
                  Forgot password?
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
