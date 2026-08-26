const momentFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

// submitted_at is a real instant, so the viewer's zone is the right one to
// show it in — same choice exams/dates.ts makes for start_time/end_time.
export function formatMoment(value: string): string {
  return momentFormat.format(new Date(value))
}
