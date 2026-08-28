import { ArrowUpIcon, SquareIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Bubble } from "@/modules/chat/Bubble"
import { ChatStatusLine } from "@/modules/chat/ChatStatusLine"
import type { ChatMessage, ChatStatus } from "@/modules/chat/useChat"

export function ChatPanel({
  messages,
  status,
  busy,
  onSend,
  onStop,
  onClose,
}: {
  messages: ChatMessage[]
  status: ChatStatus
  busy: boolean
  onSend: (content: string) => void
  onStop: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Desktop only. On a phone this is a full-screen overlay the learner has only
  // just opened, and focusing the composer throws the keyboard up over it before
  // they have read anything. Same direct matchMedia call ThemeContext uses.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus()
  }, [])

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
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight text-sidebar-foreground">Ask</h2>
        {/* On a phone the panel is a full-screen overlay stacked above the
            header, so its Ask toggle is unreachable and Escape needs a keyboard
            — this button is the only way out, and gets a 44px target to match.
            Back to the compact size once the panel is a column beside content. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-11 md:size-7"
          onClick={onClose}
          aria-label="Close chat"
        >
          <XIcon />
        </Button>
      </div>

      {/* overscroll-contain so reaching the end of the conversation does not
          start scrolling the page behind the panel. */}
      <div
        ref={listRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask anything about the training material. Answers are drawn from the documents
            your organisation has uploaded, with the sources shown.
          </p>
        ) : (
          messages.map((message) => <Bubble key={message.id} message={message} />)
        )}
      </div>

      <ChatStatusLine status={status} />

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
    </aside>
  )
}
