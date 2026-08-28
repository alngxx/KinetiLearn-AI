import { Citations } from "@/modules/chat/Citations"
import type { ChatMessage } from "@/modules/chat/useChatTurns"

// Shared by the header chat panel and the result page's explanation card, so a
// streamed answer looks the same wherever it is asked for.
export function Bubble({ message }: { message: ChatMessage }) {
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
