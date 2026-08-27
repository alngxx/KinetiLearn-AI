import { ArrowUpIcon, SquareIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Citations } from "@/modules/chat/Citations"
import type { ChatMessage, ChatStatus } from "@/modules/chat/useChat"

// What the live region says. The answer text itself is deliberately not
// announced — a token-by-token live region is unusable with a screen reader —
// so a failure has to be reported here or it is silent.
const STATUS_TEXT: Record<ChatStatus, string> = {
  idle: "",
  answering: "Answering…",
  ready: "Answer ready",
  stopped: "Stopped",
  failed: "Answer failed",
}

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

  useEffect(() => {
    inputRef.current?.focus()
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
      // page and have to be scrolled to. A column beside the content from md up.
      className="fixed inset-0 z-20 flex flex-col border-border bg-sidebar md:static md:z-auto md:w-96 md:shrink-0 md:border-l"
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

      <p role="status" className="sr-only">
        {STATUS_TEXT[status]}
      </p>

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

function Bubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <p className="ml-6 self-end rounded-xl rounded-br-sm bg-primary px-3 py-2 text-sm break-words text-primary-foreground">
        {message.content}
      </p>
    )
  }

  return (
    <div className="mr-6 flex flex-col">
      <div className="rounded-xl rounded-bl-sm border border-border bg-card px-3 py-2">
        {message.content === "" && message.status === "streaming" ? (
          <p className="text-sm text-muted-foreground">Thinking…</p>
        ) : (
          <p className="text-sm break-words whitespace-pre-wrap text-card-foreground">
            {message.content}
          </p>
        )}
        {message.status === "stopped" && (
          <p className="mt-1 text-xs text-muted-foreground">Stopped</p>
        )}
        {message.error !== null && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {message.error}
          </p>
        )}
      </div>
      <Citations citations={message.citations} />
    </div>
  )
}
