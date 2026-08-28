import { ArrowLeftIcon, ArrowUpIcon, HistoryIcon, SquareIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { QueryErrorState } from "@/components/QueryErrorState"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Bubble } from "@/modules/chat/Bubble"
import { ChatStatusLine } from "@/modules/chat/ChatStatusLine"
import { RecentChats } from "@/modules/chat/RecentChats"
import type { ChatMessage, ChatStatus } from "@/modules/chat/useChat"

export function ChatPanel({
  messages,
  status,
  busy,
  sessionId,
  restoring,
  restoreError,
  retryingRestore,
  onRetryRestore,
  onSend,
  onStop,
  onSelectSession,
  onNewChat,
  onClose,
}: {
  messages: ChatMessage[]
  status: ChatStatus
  busy: boolean
  sessionId: string | null
  restoring: boolean
  restoreError: unknown
  retryingRestore: boolean
  onRetryRestore: () => void
  onSend: (content: string) => void
  onStop: () => void
  onSelectSession: (id: string) => void
  onNewChat: () => void
  onClose: () => void
}) {
  // Not two panels: 384px has no room for a list beside the conversation, and a
  // disclosure above it would push the conversation down on a phone. One body,
  // two views.
  const [view, setView] = useState<"chat" | "history">("chat")
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Desktop only. On a phone this is a full-screen overlay the learner has only
  // just opened, and focusing the composer throws the keyboard up over it before
  // they have read anything. Same direct matchMedia call ThemeContext uses.
  // Waits for the restore, because until then there is no composer to focus.
  useEffect(() => {
    if (view !== "chat" || restoring) return
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus()
  }, [view, restoring])

  // Marks the body while the panel is mounted; index.css turns that into an
  // actual scroll lock only on the small layout. Cleanup runs on close, so the
  // page scrolls again without a separate restore path.
  useEffect(() => {
    document.body.classList.add("chat-panel-open")
    return () => document.body.classList.remove("chat-panel-open")
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [messages])

  function submit() {
    if (busy || draft.trim() === "") return
    onSend(draft)
    setDraft("")
  }

  // Swapping views replaces everything focus could be in, so it is handed to
  // the heading of the view that arrives — the same hand-off the layout makes
  // when it closes the panel.
  function show(next: "chat" | "history") {
    setView(next)
    headingRef.current?.focus()
  }

  function pick(id: string) {
    onSelectSession(id)
    show("chat")
  }

  function startNewChat() {
    onNewChat()
    show("chat")
  }

  const history = view === "history"

  return (
    // Not a Dialog: a focus trap would inert the page, and the point is to ask
    // about what is on it. Escape still closes, as a dialog would.
    <aside
      aria-label="Ask about your training"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose()
      }}
      // Overlays on a phone, where a stacked panel would sit below the whole
      // page and have to be scrolled to; a column beside the content from md up.
      // Being full-bleed, it owns the safe-area insets itself — without them the
      // Close button sits under the notch and the composer under the home
      // indicator. Reset from md up, where the layout root handles them.
      className="fixed inset-0 z-20 flex flex-col border-border bg-sidebar pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:p-0"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-11 md:size-7"
          onClick={() => show(history ? "chat" : "history")}
          aria-label={history ? "Back to the chat" : "Recent chats"}
        >
          {history ? <ArrowLeftIcon /> : <HistoryIcon />}
        </Button>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-semibold tracking-tight text-sidebar-foreground outline-none"
        >
          {history ? "Recent chats" : "Ask"}
        </h2>
        {/* On a phone the panel is a full-screen overlay stacked above the
            header, so its Ask toggle is unreachable and Escape needs a keyboard
            — this button is the only way out, and gets a 44px target to match.
            Back to the compact size once the panel is a column beside content. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto size-11 md:size-7"
          onClick={onClose}
          aria-label="Close chat"
        >
          <XIcon />
        </Button>
      </div>

      {history ? (
        <RecentChats sessionId={sessionId} onSelect={pick} onNewChat={startNewChat} />
      ) : (
        <>
          {/* overscroll-contain so reaching the end of the conversation does not
              start scrolling the page behind the panel. */}
          <div
            ref={listRef}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4"
          >
            {restoring ? (
              <p role="status" className="py-10 text-center text-sm text-muted-foreground">
                Loading…
              </p>
            ) : restoreError !== null ? (
              <QueryErrorState
                title="Could not load this chat"
                error={restoreError}
                retrying={retryingRestore}
                onRetry={onRetryRestore}
              />
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ask anything about the training material. Answers are drawn from the documents
                your organisation has uploaded, with the sources shown.
              </p>
            ) : (
              messages.map((message) => <Bubble key={message.id} message={message} />)
            )}
          </div>

          <ChatStatusLine status={status} />

          {/* No composer until the transcript is on screen. A send during that
              window would stream into a conversation the restore is about to
              replace, and the turn would be lost from the database too —
              _persist_turn only runs once the stream finishes. */}
          {!restoring && restoreError === null && (
            <div className="flex flex-col gap-2 border-t border-border p-4">
              <Textarea
                ref={inputRef}
                value={draft}
                disabled={busy}
                maxLength={4000}
                rows={2}
                name="question"
                autoComplete="off"
                placeholder="Ask a question…"
                aria-label="Your question"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              {/* Stop stays enabled while busy — it is the way out of that window,
                  including while the session is still being created. */}
              {busy ? (
                <Button variant="outline" onClick={onStop}>
                  <SquareIcon />
                  Stop
                </Button>
              ) : (
                <Button disabled={draft.trim() === ""} onClick={submit}>
                  <ArrowUpIcon />
                  Send
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </aside>
  )
}
