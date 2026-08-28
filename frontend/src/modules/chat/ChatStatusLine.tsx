import type { ChatStatus } from "@/modules/chat/useChatTurns"

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

export function ChatStatusLine({ status }: { status: ChatStatus }) {
  return (
    <p role="status" className="sr-only">
      {STATUS_TEXT[status]}
    </p>
  )
}
