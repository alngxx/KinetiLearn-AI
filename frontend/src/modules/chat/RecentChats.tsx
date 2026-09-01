import { MessageCircleIcon, PlusIcon } from "lucide-react"
import { EmptyState } from "@/components/EmptyState"
import { QueryErrorState } from "@/components/QueryErrorState"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatMoment } from "@/modules/chat/dates"
import { useChatSessions } from "@/modules/chat/queries"

// The query lives here rather than in useChat, so it only runs once the learner
// actually asks for the list — the panel opens on the conversation, not on this.
export function RecentChats({
  sessionId,
  onSelect,
  onNewChat,
}: {
  sessionId: string | null
  onSelect: (id: string) => void
  onNewChat: () => void
}) {
  const sessions = useChatSessions()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
      <Button variant="outline" className="w-full justify-start" onClick={onNewChat}>
        <PlusIcon />
        New chat
      </Button>

      {sessions.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : sessions.isError ? (
        <QueryErrorState
          title="Could not load your chats"
          error={sessions.error}
          retrying={sessions.isFetching}
          onRetry={() => void sessions.refetch()}
        />
      ) : sessions.data.length === 0 ? (
        <EmptyState
          icon={MessageCircleIcon}
          title="No chats yet"
          body="Ask a question and it will be kept here, ready to pick up later."
        />
      ) : (
        <ul aria-label="Your chats" className="flex flex-col gap-1">
          {sessions.data.map((session) => {
            const active = session.id === sessionId
            return (
              <li key={session.id}>
                <button
                  type="button"
                  // The indigo inset marks "this one" in both portals — same
                  // marker the layout's nav uses for the current page.
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(session.id)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active &&
                      "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_-2px_0_0_var(--sidebar-ring)]",
                  )}
                >
                  <span
                    className={cn(
                      // break-words as well as the clamp: a title is the first
                      // 60 characters of a question, which need not contain a
                      // space to break on.
                      "line-clamp-2 text-sm break-words text-sidebar-foreground",
                      active && "font-medium",
                    )}
                  >
                    {/* The server only lists sessions that have a turn, and a
                        turn always sets a title — but the column is nullable,
                        and a row with no label at all is unpickable. */}
                    {session.title ?? "Untitled chat"}
                  </span>
                  <time dateTime={session.updated_at} className="label-micro">
                    {formatMoment(session.updated_at)}
                  </time>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
