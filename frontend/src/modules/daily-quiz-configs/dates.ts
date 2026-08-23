const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
})

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
})

// start_date and end_date are plain calendar days. Handing "2026-03-01" to Date
// parses it as UTC midnight, which prints as the day before anywhere west of
// Greenwich, so the parts are fed in as local instead — same fix classes/dates.ts
// uses for the same shape of field.
export function formatDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number)
  return dayFormat.format(new Date(year, month - 1, day))
}

export function formatRange(start: string, end: string | null): string {
  return end === null ? `From ${formatDay(start)}` : `${formatDay(start)} – ${formatDay(end)}`
}

// push_time is local wall-clock ("HH:MM:SS"), paired with its own timezone
// column rather than being an instant, so it is formatted on its own clock
// face rather than converted through the viewer's zone.
export function formatPushTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number)
  return timeFormat.format(new Date(2000, 0, 1, hour, minute))
}
