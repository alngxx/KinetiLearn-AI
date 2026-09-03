import { ChartSplineIcon, HouseIcon, LogOutIcon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { Logo } from "@/components/Logo"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/modules/auth/useAuth"
import { ChatPanel } from "@/modules/chat/ChatPanel"
import { useChat } from "@/modules/chat/useChat"

const navLinkClasses =
  "flex items-center gap-2 rounded-lg border border-transparent px-[13px] py-[7px] text-[13.5px] font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/75 hover:bg-accent hover:text-foreground"

// A filled indigo chip rather than the admin console's underline marker: over
// the sky band an underline reads as another horizon line, and the mock wants
// the current destination to sit as a solid object in the field.
const activeClasses =
  "border-[color-mix(in_oklab,var(--ring)_40%,transparent)] bg-[color-mix(in_oklab,var(--ring)_18%,transparent)] text-foreground"

// Where the Horizon sky band is allowed to appear. The two top-level learner
// destinations get it, because both are designed around it and both lead with
// a hero the rule closes; the deeper screens (a class, a quiz in progress) do
// not, so the band still reads as arriving somewhere rather than as wallpaper.
// Set VITE_HORIZON_ALL_ROUTES=true to run it across the whole learner shell.
const horizonAllRoutes = import.meta.env.VITE_HORIZON_ALL_ROUTES === "true"
const horizonRoutes = ["/learner", "/learner/skills"]

// The horizon rule reads as one lit line: dimmer at the ends, brightest at
// centre. The mock brightens the centre with a second identity token
// (--ident-lift); this app rations its indigo through a single --ring, so the
// centre stop reads --ring-lift and falls back to --ring. Nothing defines
// --ring-lift yet — if the palette ever grows one, this lights up on its own.
const horizonRule =
  "linear-gradient(90deg, transparent, color-mix(in oklab, var(--ring) 55%, transparent) 22%, color-mix(in oklab, var(--ring-lift, var(--ring)) 70%, transparent) 50%, color-mix(in oklab, var(--ring) 55%, transparent) 78%, transparent)"

// Decorative only, and announced to nobody: the band carries no information a
// screen-reader user would otherwise miss.
//
// md and up only. The horizon rule is a fixed offset (--band-h) that has to
// land in the gap between the hero and the first section; below md the
// description wraps and moves that gap, and no fixed number clears every wrap
// state. A phone gets the flat treatment rather than a rule through its text.
function SkyBand() {
  return (
    <div className="hidden md:block">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[var(--band-h)] overflow-hidden"
      >
        <div className="absolute inset-0" style={{ background: "var(--sky)" }} />
        <div
          className="absolute top-0 left-1/2 h-[430px] w-[1100px] -translate-x-1/2 -translate-y-40 blur-[60px]"
          style={{ background: "radial-gradient(ellipse at 50% 50%, var(--bloom), transparent 70%)" }}
        />
        {/* Held at full strength most of the way down, then dropped over the
            last quarter so the field thins out into the horizon rule rather
            than stopping at it. */}
        <div
          className="absolute inset-0"
          style={{
            maskImage: "linear-gradient(180deg, #000 0%, #000 72%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(180deg, #000 0%, #000 72%, transparent 100%)",
          }}
        >
          <div className="sky-star sky-star-1" />
          <div className="sky-star sky-star-2" />
          <div className="sky-star sky-star-3" />
        </div>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[var(--band-h)] -z-10 h-px"
        style={{ background: horizonRule }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-[10%] top-[var(--band-h)] -z-10 h-[130px] blur-[26px]"
        style={{ background: "radial-gradient(ellipse at 50% 0%, var(--glow), transparent 70%)" }}
      />
    </div>
  )
}

// A top bar rather than the admin sidebar: the learner has one destination, and
// the chat panel needs the horizontal room a nav column would take.
export function LearnerLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const showHorizon = horizonAllRoutes || horizonRoutes.includes(pathname)
  // Closing the panel only unmounts ChatPanel. useChat, and with it the fetch
  // and its AbortController, stays here — so an answer in flight finishes while
  // the panel is shut and is waiting when it reopens. Do not "clean up" by
  // calling stop() on close, and do not move useChat into ChatPanel.
  const [chatOpen, setChatOpen] = useState(false)
  const askRef = useRef<HTMLButtonElement>(null)
  // Gated on chatOpen: the panel boots closed on every page load, so the
  // restore fetch is not paid for by a learner who never opens it.
  const chat = useChat(chatOpen)

  // Focus is inside the panel, so unmounting it would drop focus to <body> and
  // lose the keyboard user's place. Standard disclosure behaviour is to hand it
  // back to the control that opened it — the Ask FAB, which is kept mounted for
  // exactly this reason even while the panel covers it.
  function closeChat() {
    setChatOpen(false)
    askRef.current?.focus()
  }

  return (
    // Landscape notches eat into both edges, so the insets sit on the root and
    // every row inside inherits the safe width.
    //
    // `relative isolate` anchors the sky band and keeps its negative z-index
    // inside this subtree. Deliberately NOT overflow-hidden: that would make
    // this element the scroll container and the sticky header would never
    // stick. The band clips itself instead.
    <div className="relative isolate flex min-h-svh flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {showHorizon && <SkyBand />}

      {/* First thing in the tab order: skips the whole header. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* min-h rather than h: --header-h is what the chat panel offsets itself
          by, so the bar has to actually be that tall — but this row wraps on a
          narrow window, and a fixed height would clip the second line. */}
      {/* Over the band the bar carries no fill at all, exactly as the mock has
          it: the sky and its stars run straight through. The mock's header is
          static; ours sticks, so it keeps a backdrop-blur — on the band that
          blurs a near-uniform gradient and is invisible, and once the bar
          scrolls onto flat content it is what keeps cards from sliding
          legibly-unblurred under the nav. */}
      <header
        className={cn(
          "sticky top-0 z-10 flex min-h-[var(--header-h)] flex-wrap items-center gap-x-[26px] gap-y-3 border-b px-[26px] pt-[calc(0.875rem+env(safe-area-inset-top))] pb-[0.875rem]",
          showHorizon
            ? "border-border/70 md:bg-transparent md:backdrop-blur-md"
            : "border-sidebar-border bg-sidebar",
        )}
      >
        <div className="flex items-center gap-[11px]">
          <Logo />
          <span aria-hidden="true" className="h-4 w-px bg-border" />
          <p className="label-micro">Learner</p>
        </div>

        <nav className="ml-[10px] flex items-center gap-1">
          <NavLink
            to="/learner"
            end
            className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
          >
            <HouseIcon className="size-4" />
            Home
          </NavLink>
          <NavLink
            to="/learner/skills"
            className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
          >
            <ChartSplineIcon className="size-4" />
            Skills
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              logout()
              navigate("/login", { replace: true })
            }}
          >
            <LogOutIcon />
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 px-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-10 outline-none"
        >
          {/* Keyed on the route so the entrance replays on navigation — the
              wrapper itself never unmounts, only the Outlet's contents do.
              Narrower than the sky band above it and centered on purpose: the
              band and horizon rule stay full-bleed, but the actual reading
              column is a deliberately tighter well so text lines and cards
              don't stretch edge-to-edge on a wide monitor. */}
          <div key={pathname} className="enter-rise mx-auto w-full max-w-[600px]">
            <Outlet />
          </div>
        </main>

        {chatOpen && (
          <ChatPanel
            messages={chat.messages}
            status={chat.status}
            busy={chat.busy}
            sessionId={chat.sessionId}
            restoring={chat.restoring}
            restoreError={chat.restoreError}
            retryingRestore={chat.retryingRestore}
            onRetryRestore={chat.retryRestore}
            onSend={(content) => void chat.send(content)}
            onStop={chat.stop}
            onSelectSession={chat.openSession}
            onNewChat={chat.newChat}
            onClose={closeChat}
          />
        )}
      </div>

      {/* Always mounted, never conditional: closeChat() calls focus() on this ref
          in the same tick it clears chatOpen, so a FAB that unmounted while open
          would drop the keyboard user on <body>. When the panel is open it is
          shifted, hidden behind, or relabelled — never removed.

          Below md the panel is a full-screen overlay at z-20 and covers this; the
          panel's own Close button is the way out there, which is why it carries a
          44px target. From md up the panel is a static 24rem column, so the FAB
          steps left of it rather than sitting on the composer.

          Bottom-right is also sonner's default corner, but every toast in the app
          fires from an admin screen and this is learner-only. A learner-side toast
          added later would need to clear this. */}
      <Button
        ref={askRef}
        variant="ghost"
        aria-expanded={chatOpen}
        onClick={() => setChatOpen((open) => !open)}
        className={cn(
          "fixed right-[calc(1.5rem+env(safe-area-inset-right))] bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-10",
          "h-11 gap-2.5 rounded-full px-5 shadow-floating hover:-translate-y-0.5",
          // A surface pill rather than a filled primary one: this sits over the
          // learner's content on every screen, so it stays quiet and lets the
          // live dot carry the signal. Border borrows the same rationed indigo
          // as the horizon rule.
          "border-[color-mix(in_oklab,var(--ring)_45%,transparent)] bg-card text-foreground hover:bg-card",
          "hover:shadow-[var(--elevation-floating),0_0_0_3px_var(--glow)]",
          chatOpen && "md:right-[calc(25.5rem+env(safe-area-inset-right))]",
        )}
      >
        {chatOpen ? (
          <XIcon />
        ) : (
          // Live-looking, not live — the same ring-behind-a-steady-dot idiom
          // the login landing uses. On a neutral pill the accent finally reads,
          // so this is --ring rather than a foreground pip.
          <span aria-hidden="true" className="relative inline-flex size-[7px]">
            <span className="pace-ping absolute inset-0 rounded-full bg-ring" />
            <span className="relative size-[7px] rounded-full bg-ring" />
          </span>
        )}
        {chatOpen ? "Close" : "Ask Pace"}
      </Button>
    </div>
  )
}
