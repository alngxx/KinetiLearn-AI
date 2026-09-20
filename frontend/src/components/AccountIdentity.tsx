import { Loader2Icon, XIcon } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/lib/errors"
import { cn } from "@/lib/utils"
import { useClampedText } from "@/lib/useClampedText"
import { AVATAR_MAX_SIZE, AVATAR_MIME_TYPES } from "@/modules/users/api"
import { useMe, useRemoveAvatar, useSetAvatar } from "@/modules/users/queries"

// First and last word, so "Nguyen Thi Thu Ha" reads NH rather than NT. A
// single-word name gives one letter instead of padding it with a duplicate.
export function initialsFromName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter((word) => word !== "")
  if (words.length === 0) return "?"
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ""
  return `${first}${last}`.toUpperCase()
}

// Checked here only to save a round trip on an obviously wrong file. The server
// sniffs the actual bytes, so this is a convenience, not the gate.
function localRejection(file: File): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type)) return "Choose a PNG, JPEG, or WebP image."
  if (file.size > AVATAR_MAX_SIZE) return "Choose an image under 2 MB."
  return null
}

// compact: the learner header's identity slot has no definite width of its
// own (it lives in a `ml-auto` cluster that shrinks to fit its content), and
// useClampedText needs the OPPOSITE — a box whose width is settled before its
// first measurement, or its first pass races the layout and over-truncates
// (verified live: "Mike Ross" came back "Mike…" with room to spare). The admin
// sidebar row has a real width from the start (the resizable <aside> sets it
// directly), so useClampedText's word-boundary clamp works correctly there and
// stays the default. The learner header instead gets plain CSS truncation,
// which needs no measured width and can't race anything — the trade is losing
// word-boundary precision on the rare very long name, in exchange for a name
// tag that never mis-clamps a short one.
export function AccountIdentity({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const me = useMe()
  const setAvatar = useSetAvatar()
  const removeAvatar = useRemoveAvatar()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()

  const fullName = me.data?.full_name ?? ""
  // Still called unconditionally either way — hooks can't be conditional —
  // but its output is only rendered when !compact.
  const name = useClampedText<HTMLSpanElement>(fullName, 1)

  // Nothing to identify until the user resolves. Rendering a placeholder first
  // would only swap itself out a moment later.
  if (me.data === undefined) return null

  const avatarUrl = me.data.avatar_url ?? null
  const busy = setAvatar.isPending || removeAvatar.isPending

  function handleFile(file: File) {
    const rejection = localRejection(file)
    if (rejection !== null) {
      setError(rejection)
      return
    }
    setError(undefined)
    setAvatar.mutate(file, {
      onError: (err) => {
        setError(isApiError(err) ? err.message : "Could not update your photo.")
      },
    })
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {/* tabIndex={-1} is deliberate: the button beside it is the only tab
            stop, and a focusable-but-invisible input next to it would be a
            keyboard trap with nothing to show for itself. The button opens the
            picker programmatically instead. */}
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_MIME_TYPES.join(",")}
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            // Cleared so picking the same file twice still fires a change,
            // which matters right after a failed upload.
            event.target.value = ""
            if (chosen !== undefined) handleFile(chosen)
          }}
        />

        <button
          type="button"
          disabled={busy}
          aria-label={avatarUrl === null ? "Add a photo" : "Change your photo"}
          onClick={() => inputRef.current?.click()}
          className="flex size-9 shrink-0 touch-manipulation items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground ring-2 ring-transparent transition-colors outline-none hover:bg-sidebar-border hover:ring-ring/50 focus-visible:ring-3 focus-visible:ring-ring/75 disabled:opacity-50"
        >
          {busy ? (
            <Loader2Icon className="size-4 motion-safe:animate-spin" />
          ) : avatarUrl === null ? (
            initialsFromName(fullName)
          ) : (
            <img src={avatarUrl} alt="" width={36} height={36} className="size-full object-cover" />
          )}
        </button>

        {compact ? (
          <span
            title={fullName}
            className="min-w-0 truncate text-sm text-sidebar-foreground"
          >
            {fullName}
          </span>
        ) : (
          <span
            ref={name.ref}
            title={fullName}
            className="max-h-[1lh] min-w-0 flex-1 overflow-hidden text-sm text-sidebar-foreground"
          >
            {name.text}
          </span>
        )}

        {avatarUrl !== null && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Remove your photo"
            disabled={busy}
            onClick={() => {
              setError(undefined)
              removeAvatar.mutate(undefined, {
                onError: (err) => {
                  setError(isApiError(err) ? err.message : "Could not remove your photo.")
                },
              })
            }}
          >
            <XIcon />
          </Button>
        )}
      </div>

      {error !== undefined && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
