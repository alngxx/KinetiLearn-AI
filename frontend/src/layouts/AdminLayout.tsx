import {
  CalendarClockIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  GraduationCapIcon,
  LogOutIcon,
  UsersIcon,
} from "lucide-react"
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { AccountIdentity } from "@/components/AccountIdentity"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/Logo"
import { cn } from "@/lib/utils"
import { getStoredSidebarWidth, setStoredSidebarWidth } from "@/lib/sidebarWidthStorage"
import { configEntities } from "@/modules/config/descriptors"
import { useAuth } from "@/modules/auth/useAuth"

const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 400
const SIDEBAR_DEFAULT_WIDTH = 240 // the old w-60
const SIDEBAR_KEYBOARD_STEP = 16

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))
}

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

  const [sidebarWidth, setSidebarWidth] = useState(
    () => clampSidebarWidth(getStoredSidebarWidth() ?? SIDEBAR_DEFAULT_WIDTH),
  )
  // Drives a page-wide select-none while dragging — without it, a drag that
  // overshoots the handle by a pixel selects the nav link text underneath it.
  const [isDragging, setIsDragging] = useState(false)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  function commitSidebarWidth(width: number) {
    const clamped = clampSidebarWidth(width)
    setSidebarWidth(clamped)
    setStoredSidebarWidth(clamped)
  }

  function handleHandlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth }
    setIsDragging(true)
  }

  function handleHandlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    commitSidebarWidth(drag.startWidth + (event.clientX - drag.startX))
  }

  function handleHandlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) dragStateRef.current = null
    setIsDragging(false)
  }

  function handleHandleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      commitSidebarWidth(sidebarWidth - SIDEBAR_KEYBOARD_STEP)
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      commitSidebarWidth(sidebarWidth + SIDEBAR_KEYBOARD_STEP)
    } else if (event.key === "Home") {
      event.preventDefault()
      commitSidebarWidth(SIDEBAR_MIN_WIDTH)
    } else if (event.key === "End") {
      event.preventDefault()
      commitSidebarWidth(SIDEBAR_MAX_WIDTH)
    }
  }

  return (
    <div className={cn("flex min-h-svh", isDragging && "select-none")}>
      {/* First thing in the tab order: skips the whole sidebar. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside
        className="sticky top-0 flex h-svh shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-5"
        style={{ width: sidebarWidth }}
      >
        {/* Lights the existing border rather than replacing it: the
            gradient fades to transparent at both ends, and in dark mode
            --sidebar sits only 0.02 lightness from --background, so a
            gradient alone would leave the edge invisible top and bottom. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-px"
          style={{ background: sidebarRule }}
        />

        {/* Hit target is wider than what's drawn — a 1px line is unreachable
            with a mouse, so the visible grip only fills in on hover/focus
            while the draggable area stays generous. Sits on the sticky
            aside's own positioning context, same as the rule span above. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={sidebarWidth}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          tabIndex={0}
          onPointerDown={handleHandlePointerDown}
          onPointerMove={handleHandlePointerMove}
          onPointerUp={handleHandlePointerUp}
          onKeyDown={handleHandleKeyDown}
          className="group absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none items-stretch justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/75"
        >
          <span
            aria-hidden="true"
            className="w-px bg-transparent transition-colors group-hover:bg-ring/60 group-focus-visible:bg-ring group-active:bg-ring"
          />
        </div>
        <div className="px-2.5">
          <Logo />
          <p className="label-micro mt-0.5">Admin</p>
        </div>

        {/* flex-1 + min-h-0 + overflow-y-auto: without this the nav's own
            content height wins and the aside (fixed to h-svh) just overflows
            downward, taking the identity block and Sign out with it below the
            fold — reachable only by scrolling the whole page. min-h-0 is load
            bearing: a flex item's automatic minimum height is its content
            size, which blocks shrinking (and so blocks the scroll region)
            without it. This keeps the footer always visible within the
            viewport instead. */}
        <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
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

        {/* The identity row stacks above the controls rather than joining them:
            at the 200px floor a name, a theme toggle and "Sign out" cannot
            share a line, and the name is the one that must stay readable.
            flex-wrap on the inner row is still the overflow fix it always was —
            theme toggle + "Sign out" don't both fit near that floor either, and
            nothing here clips, so without it "Sign out" bled past the sidebar's
            right edge. A single wrapped item still lands flush left, since
            justify-between has nothing to space apart on a line of one. */}
        <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border pt-3">
          <AccountIdentity />

          <div className="flex flex-wrap items-center justify-between gap-2">
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
