import { useEffect, useState } from "react"
import { errorsFromResponse, validateFields } from "@/components/form/helpers"
import type { FormField, FormValues } from "@/components/form/types"

type Options = {
  fields: FormField[]
  initial: FormValues
  // Cross-field rules the field list cannot express on its own.
  validate?: (values: FormValues) => Record<string, string>
  onSubmit: (values: FormValues) => Promise<void>
}

export function useEntityForm({ fields, initial, validate, onSubmit }: Options) {
  const [values, setValues] = useState<FormValues>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Focus moves from an effect, not inside submit() itself: the error
  // paragraph a field's aria-describedby points at has to actually be in the
  // DOM first, which only true after this render commits.
  const [focusTarget, setFocusTarget] = useState<string | null>(null)

  useEffect(() => {
    if (focusTarget === null) return
    document.getElementById(focusTarget)?.focus()
    // Cleared right after: the same field failing twice in a row would
    // otherwise set identical state, React would bail out of the effect, and
    // focus would silently stop moving on the second bad attempt.
    setFocusTarget(null)
  }, [focusTarget])

  function setValue(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }))
    // Clear the message as soon as the field is touched again.
    setErrors((current) => {
      if (!(name in current)) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  function firstInvalid(found: Record<string, string>) {
    return fields.find((field) => field.name in found)?.name
  }

  // fallbackFocusId names a control this hook does not validate — the page
  // checked it itself and it failed. A field error this hook did find always
  // wins, since fallbackFocusId has no way to know it lost that race.
  async function submit(fallbackFocusId?: string) {
    const found = { ...validateFields(fields, values), ...validate?.(values) }
    const target = firstInvalid(found) ?? fallbackFocusId
    if (target !== undefined) {
      setErrors(found)
      setFormError(null)
      setFocusTarget(target)
      return
    }

    setSubmitting(true)
    setErrors({})
    setFormError(null)
    try {
      await onSubmit(values)
    } catch (err) {
      const failure = errorsFromResponse(err, fields)
      setErrors(failure.fieldErrors)
      setFormError(failure.formError)
      // A 409/422 can name a field the admin has already scrolled past.
      setFocusTarget(firstInvalid(failure.fieldErrors) ?? null)
    } finally {
      setSubmitting(false)
    }
  }

  return { values, errors, formError, submitting, setValue, submit }
}
