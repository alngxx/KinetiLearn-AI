// The countdown on the take page. Nothing on the server tracks when an attempt
// started — submissions.started_at is stamped at submit and is in no response —
// so the clock can only run from the moment the page opened, and reloading
// starts it over. The page says so rather than implying an enforced limit.
export function deadlineFor(mountedAt: number, durationMinutes: number, endTime: string): number {
  return Math.min(mountedAt + durationMinutes * 60_000, new Date(endTime).getTime())
}

// h:mm:ss past an hour, mm:ss below it. Clamped at zero: expiry is a state the
// page handles, not a negative number to render.
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const pad = (value: number) => String(value).padStart(2, "0")
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}
