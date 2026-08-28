import { ChartSplineIcon, HouseIcon, LogOutIcon, MessageCircleIcon } from "lucide-react"
import { useRef, useState } from "react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useAuth } from "@/modules/auth/useAuth"
import { ChatPanel } from "@/modules/chat/ChatPanel"
import { useChat } from "@/modules/chat/useChat"

const navLinkClasses =
  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"

// Same brass marker the admin console uses for the active item, so the colour
// means "this one" in both portals.
const activeClasses =
  "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_0_-2px_0_0_var(--sidebar-ring)]"

// A top bar rather than the admin sidebar: the learner has one destination, and
// the chat panel needs the horizontal room a nav column would take.
export function LearnerLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
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
  // back to the control that opened it — and below md that toggle is also the
  // only way back in, since the panel covers the header.
  function closeChat() {
    setChatOpen(false)
    askRef.current?.focus()
  }

  return (
    // Landscape notches eat into both edges, so the insets sit on the root and
    // every row inside inherits the safe width.
    <div className="flex min-h-svh flex-col bg-background pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      {/* First thing in the tab order: skips the whole header. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-sidebar-border bg-sidebar px-6 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <div>
          <span
            translate="no"
            className="text-sm font-semibold tracking-tight text-sidebar-foreground"
          >
            KinetiLearn
          </span>
          <p className="label-micro mt-0.5">Learner</p>
        </div>

        <nav className="flex items-center gap-0.5">
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
          <Button
            ref={askRef}
            variant="outline"
            size="sm"
            aria-expanded={chatOpen}
            onClick={() => setChatOpen((open) => !open)}
          >
            <MessageCircleIcon />
            Ask
          </Button>
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
          className="min-w-0 flex-1 px-6 pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))] outline-none"
        >
          <div className="mx-auto max-w-4xl">
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
    </div>
  )
}
