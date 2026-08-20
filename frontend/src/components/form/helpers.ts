import type { FormField, FormValues } from "@/components/form/types"
import { isApiError } from "@/lib/errors"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateFields(
  fields: FormField[],
  values: FormValues,
): Record<string, string> {
  const errors: Record<string, string> = {}

  for (const field of fields) {
    const raw = (values[field.name] ?? "").trim()

    if (raw === "") {
      if (field.required === true) errors[field.name] = `${field.label} is required.`
      continue
    }
    if (field.kind === "email" && !EMAIL_PATTERN.test(raw)) {
      errors[field.name] = "Enter a valid email address."
      continue
    }
    if (field.pattern !== undefined && !field.pattern.test(raw)) {
      errors[field.name] = field.patternMessage ?? `${field.label} is not valid.`
      continue
    }
    if (field.minLength !== undefined && raw.length < field.minLength) {
      errors[field.name] = `${field.label} must be at least ${field.minLength} characters.`
      continue
    }
    if (field.maxLength !== undefined && raw.length > field.maxLength) {
      errors[field.name] = `${field.label} must be ${field.maxLength} characters or fewer.`
      continue
    }
    if (field.kind === "number") {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 0) {
        errors[field.name] = `${field.label} must be a whole number, 0 or higher.`
      }
    }
  }

  return errors
}

// On create an untouched optional field is left null so the column stays empty;
// on edit it is sent as "" so clearing it actually clears it. Optional foreign
// keys stay null in both cases — "" is not a valid id.
export function buildPayload(
  fields: FormField[],
  values: FormValues,
  mode: "create" | "edit",
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  for (const field of fields) {
    const raw = (values[field.name] ?? "").trim()
    if (raw === "") {
      payload[field.name] = mode === "create" || field.kind === "select" ? null : ""
      continue
    }
    payload[field.name] = field.kind === "number" ? Number(raw) : raw
  }

  return payload
}

// A 409 arrives as a sentence ("Seniority level rank already exists."). The
// attribute at fault is the word immediately before "already exists", so match
// there first — a loose scan picks the wrong field when another field's label
// also appears in the sentence ("Skill name already exists in this category."
// would otherwise land on Category rather than Name).
export function fieldFromConflict(message: string, fields: FormField[]): string | null {
  const haystack = message.toLowerCase()

  const anchored = /(\w+)\s+already exists/.exec(haystack)
  if (anchored !== null) {
    const token = anchored[1]
    const match = fields.find(
      (field) => field.name === token || field.label.toLowerCase().split(" ").pop() === token,
    )
    if (match !== undefined) return match.name
  }

  const loose = fields.find((field) => haystack.includes(field.label.toLowerCase()))
  return loose === undefined ? null : loose.name
}

export type SubmitFailure = {
  fieldErrors: Record<string, string>
  formError: string | null
}

export function errorsFromResponse(err: unknown, fields: FormField[]): SubmitFailure {
  if (!isApiError(err)) {
    return { fieldErrors: {}, formError: "Something went wrong. Please try again." }
  }

  if (err.status === 409) {
    const field = fieldFromConflict(err.message, fields)
    if (field !== null) return { fieldErrors: { [field]: err.message }, formError: null }
  }

  // normalizeError already turned a 422 body into per-field messages; keep the
  // ones naming a field this form renders.
  if (err.fields !== undefined) {
    const known: Record<string, string> = {}
    for (const field of fields) {
      const message = err.fields[field.name]
      if (message !== undefined) known[field.name] = message
    }
    if (Object.keys(known).length > 0) return { fieldErrors: known, formError: null }
  }

  return { fieldErrors: {}, formError: err.message }
}
