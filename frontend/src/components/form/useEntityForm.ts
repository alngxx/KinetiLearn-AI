import { useState } from "react"
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

  async function submit() {
    const found = { ...validateFields(fields, values), ...validate?.(values) }
    if (Object.keys(found).length > 0) {
      setErrors(found)
      setFormError(null)
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
    } finally {
      setSubmitting(false)
    }
  }

  return { values, errors, formError, submitting, setValue, submit }
}
