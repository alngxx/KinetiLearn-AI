import {
  CalendarClockIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  GraduationCapIcon,
  LogOutIcon,
  UsersIcon,
} from "lucide-react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/Logo"
import { cn } from "@/lib/utils"
import { configEntities } from "@/modules/config/descriptors"
import { useAuth } from "@/modules/auth/useAuth"

const navLinkClasses =
  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"

// The active item carries the identity indigo, so the colour means "this one"
// throughout the console. Blended toward transparent via color-mix rather than
// a Tailwind opacity modifier, since a box-shadow colour can't take a "/"
// suffix; 20% is the most it can give away and still clear 3:1 against the
// active row.
const activeClasses =
  "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_color-mix(in_oklch,var(--sidebar-ring),transparent_20%)]"

// Top-level destinations get the band, mirroring LearnerLayout's
// horizonRoutes: it reads as arriving somewhere rather than as wallpaper
// on every drill-down. Exact match on the array (not startsWith) is what
// keeps /admin/classes/:classId and /admin/users/:userId/skills off it —
// only the config entity route is a genuine prefix match, since its 6
// variants all live under one path shape.
const bandRoutes = [
  "/admin/users",
  "/admin/classes",
  "/admin/documents",
  "/admin/daily-quizzes",
  "/admin/submissions",
]

// Vertical analogue of the learner header's horizon rule: same lit-line
// construction (dim at the ends, brightest at centre, --ring-lift falls
// back to --ring), turned 90deg to run down the sidebar's edge instead of
// across the top of a sky band.
const sidebarRule =
  "linear-gradient(180deg, transparent, color-mix(in oklab, var(--ring) 55%, transparent) 22%, color-mix(in oklab, var(--ring-lift, var(--ring)) 70%, transparent) 50%, color-mix(in oklab, var(--ring) 55%, transparent) 78%, transparent)"

export function AdminLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const showBand = bandRoutes.includes(pathname) || pathname.startsWith("/admin/config/")

  return (
    <div className="flex min-h-svh">
      {/* First thing in the tab order: skips the whole sidebar. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-5">
        {/* Lights the existing border rather than replacing it: the
            gradient fades to transparent at both ends, and in dark mode
            --sidebar sits only 0.02 lightness from --background, so a
            gradient alone would leave the edge invisible top and bottom. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-px"
          style={{ background: sidebarRule }}
        />
        <div className="px-2.5">
          <Logo />
          <p className="label-micro mt-0.5">Admin</p>
        </div>

        <nav className="flex flex-col gap-5">
          <div className="flex flex-col gap-0.5">
            <span className="label-micro px-2.5 pb-1">People</span>
            <NavLink
              to="/admin/users"
              className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
            >
              <UsersIcon className="size-4" />
              Users
            </NavLink>
            <NavLink
              to="/admin/classes"
              className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
            >
              <GraduationCapIcon className="size-4" />
              Classes
            </NavLink>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="label-micro px-2.5 pb-1">Content</span>
            <NavLink
              to="/admin/documents"
              className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
            >
              <FileTextIcon className="size-4" />
              Documents
            </NavLink>
            <NavLink
              to="/admin/daily-quizzes"
              className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
            >
              <CalendarClockIcon className="size-4" />
              Daily Quiz
            </NavLink>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="label-micro px-2.5 pb-1">Review</span>
            <NavLink
              to="/admin/submissions"
              className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
            >
              <ClipboardCheckIcon className="size-4" />
              Submission
            </NavLink>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="label-micro px-2.5 pb-1">Configuration</span>
            {configEntities.map((entity) => (
              <NavLink
                key={entity.key}
                to={`/admin/config/${entity.key}`}
                className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
              >
                {entity.label}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-sidebar-border pt-3">
          <ThemeToggle />

          <Button
            variant="ghost"
            size="sm"
            className="justify-start px-2"
            onClick={() => {
              logout()
              navigate("/login", { replace: true })
            }}
          >
            <LogOutIcon />
            Sign out
          </Button>
        </div>
      </aside>

      {/* relative anchors the band below to this column rather than the
          viewport, so its bloom centres on content and not on the browser
          window. isolate confines the band's -z-10 to this subtree so it
          can't fall behind the page's --ambient-glow layer (body::before).
          If the band ever moves into the sidebar instead, it will render
          invisible there — the aside is sticky with no stacking context of
          its own, so bg-sidebar paints over anything at -z-10 inside it. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="relative isolate min-w-0 flex-1 px-8 py-8 outline-none"
      >
        {showBand && (
          // Same technique as the learner sky band, minus the horizontal
          // rule and separate glow ellipse: admin's PageHeader already
          // supplies its own border-b, so nothing needs to land in a gap
          // and the band doesn't need a height coupled to any rhythm.
          // Masked rather than left to end in a flat colour — the sky's
          // foot is darker than --background in dark mode, and a mask
          // fades to nothing instead of leaving a seam.
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[220px] overflow-hidden"
            style={{
              maskImage: "linear-gradient(180deg, #000 0%, #000 45%, transparent 100%)",
              WebkitMaskImage: "linear-gradient(180deg, #000 0%, #000 45%, transparent 100%)",
            }}
          >
            <div className="absolute inset-0" style={{ background: "var(--sky)" }} />
            <div
              className="absolute top-0 left-1/2 h-[430px] w-[1100px] -translate-x-1/2 -translate-y-40 blur-[60px]"
              style={{ background: "radial-gradient(ellipse at 50% 50%, var(--bloom), transparent 70%)" }}
            />
            <div className="sky-star sky-star-1" />
            <div className="sky-star sky-star-2" />
            <div className="sky-star sky-star-3" />
          </div>
        )}
        <div key={pathname} className="enter-rise mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
