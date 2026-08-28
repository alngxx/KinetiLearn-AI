const momentFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

// When a conversation was last added to. A real instant, so the viewer's zone
// is right — same choice classes/dates.ts makes for start_time/end_time.
export function formatMoment(value: string): string {
  return momentFormat.format(new Date(value))
}
