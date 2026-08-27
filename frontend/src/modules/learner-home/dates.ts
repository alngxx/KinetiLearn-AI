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

// quiz_date is a plain calendar day. Handing "2026-03-01" to Date parses it as
// UTC midnight, which prints as the day before anywhere west of Greenwich, so
// the parts are fed in as local — same fix classes/dates.ts uses.
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

// end_time and expires_at are real instants, so the viewer's zone is right.
export function formatMoment(value: string): string {
  return momentFormat.format(new Date(value))
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

const relativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
]

// How long is left on a quiz. expires_at is expiry_hours after the quiz was
// generated, not midnight, so "tomorrow" would be a guess — this reads the
// actual remaining time. The verb is part of the string: RelativeTimeFormat
// alone gives "in 6 hours", which beside a question count reads as "5 questions
// · in 6 hours" and never says what happens then.
export function formatRemaining(value: string): string {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000
  if (seconds <= 0) return "Expired"
  for (const [unit, size] of relativeUnits) {
    if (seconds >= size) {
      return `Expires ${relativeFormat.format(Math.round(seconds / size), unit)}`
    }
  }
  return "Expires in under a minute"
}
