const momentFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

// An exercise schedule is a real instant, so it is shown in the viewer's zone.
export function formatMoment(value: string): string {
  return momentFormat.format(new Date(value))
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" with no zone, read as
// the viewer's local time. Building it from the local getters is what keeps an
// instant on the clock the admin is actually looking at; toISOString().slice()
// would silently shift it by the UTC offset.
export function toDateTimeLocal(iso: string): string {
  const at = new Date(iso)
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

// The inverse. A date-time string with no offset is parsed as local time, so
// this lands back on the same instant toDateTimeLocal was given — to the minute,
// which is all datetime-local carries.
export function toIso(local: string): string {
  return new Date(local).toISOString()
}
