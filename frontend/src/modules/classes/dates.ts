const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
})

const momentFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

// start_date and end_date are plain calendar days. Handing "2026-03-01" to Date
// parses it as UTC midnight, which prints as the day before anywhere west of
// Greenwich, so the parts are fed in as local instead.
export function formatDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number)
  return dayFormat.format(new Date(year, month - 1, day))
}

export function formatRange(start: string | null, end: string | null): string {
  if (start === null && end === null) return "No dates set"
  if (start === null) return `Until ${formatDay(end as string)}`
  if (end === null) return `From ${formatDay(start)}`
  return `${formatDay(start)} – ${formatDay(end)}`
}

// Exercise start_time and end_time are real instants, so the viewer's zone is
// the right one to show them in.
export function formatMoment(value: string): string {
  return momentFormat.format(new Date(value))
}
