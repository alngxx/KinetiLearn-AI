export type FormValues = Record<string, string>

export type Option = {
  value: string
  label: string
}

export type FormField = {
  name: string
  label: string
  kind:
    | "text"
    | "textarea"
    | "number"
    | "select"
    | "password"
    | "email"
    | "date"
    | "datetime"
    | "time"
  required?: boolean
  // Names a list the page supplies; the page owns where that list comes from.
  optionsFrom?: string
  pattern?: RegExp
  patternMessage?: string
  maxLength?: number
  minLength?: number
  placeholder?: string
  helpText?: string
}
