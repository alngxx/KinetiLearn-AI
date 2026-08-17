// The API returns two different error shapes. A raised HTTPException gives
// {"detail": "message"}, while a Pydantic validation failure gives
// {"detail": [{loc, msg, type}, ...]}. Everything in the app works with ApiError
// instead of either raw shape.

export type ApiError = {
  status: number
  message: string
  fields?: Record<string, string>
}

type ValidationItem = {
  loc: (string | number)[]
  msg: string
  type: string
}

const GENERIC_MESSAGE = "Something went wrong. Please try again."
const NETWORK_MESSAGE = "Could not reach the server. Check your connection."

// Where the invalid value sat in the request. The first segment is the source
// ("body", "query", ...) and is dropped, so a field name is left.
const LOCATION_PREFIXES = ["body", "query", "path", "header", "cookie"]

function isValidationList(detail: unknown): detail is ValidationItem[] {
  return (
    Array.isArray(detail) &&
    detail.length > 0 &&
    detail.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ValidationItem).msg === "string" &&
        Array.isArray((item as ValidationItem).loc),
    )
  )
}

export function fieldNameFromLoc(loc: (string | number)[]): string | null {
  const names = loc.filter((part): part is string => typeof part === "string")
  const withoutPrefix =
    names.length > 1 && LOCATION_PREFIXES.includes(names[0]) ? names.slice(1) : names
  if (withoutPrefix.length === 0) return null
  return withoutPrefix[withoutPrefix.length - 1]
}

export function normalizeError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail

  if (typeof detail === "string" && detail.length > 0) {
    return { status, message: detail }
  }

  if (isValidationList(detail)) {
    const fields: Record<string, string> = {}
    for (const item of detail) {
      const name = fieldNameFromLoc(item.loc)
      // First message wins: a field with several failures shows one line.
      if (name !== null && !(name in fields)) fields[name] = item.msg
    }
    return {
      status,
      message: detail.map((item) => item.msg).join("; "),
      fields,
    }
  }

  return { status, message: GENERIC_MESSAGE }
}

// The request never reached the server, so there is no status to report.
export function networkError(): ApiError {
  return { status: 0, message: NETWORK_MESSAGE }
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ApiError).status === "number" &&
    typeof (value as ApiError).message === "string"
  )
}
