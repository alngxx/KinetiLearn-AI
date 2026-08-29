import { FieldRow } from "kinetilearn-frontend"

export function TextAndSelect() {
  return (
    <div className="flex max-w-md flex-col gap-4">
      <FieldRow
        field={{ name: "name", label: "Class name", kind: "text", required: true }}
        value="Onboarding — Engineering"
        onChange={() => {}}
      />
      <FieldRow
        field={{
          name: "department",
          label: "Department",
          kind: "select",
          optionsFrom: "departments",
        }}
        value="engineering"
        options={[
          { value: "engineering", label: "Engineering" },
          { value: "sales", label: "Sales" },
        ]}
        onChange={() => {}}
      />
    </div>
  )
}

export function WithHelpAndError() {
  return (
    <div className="flex max-w-md flex-col gap-4">
      <FieldRow
        field={{
          name: "pass_mark",
          label: "Pass mark",
          kind: "number",
          required: true,
          helpText: "Percentage a learner must reach to pass.",
        }}
        value="70"
        onChange={() => {}}
      />
      <FieldRow
        field={{ name: "email", label: "Work email", kind: "email", required: true }}
        value="not-an-email"
        error="Enter a valid email address."
        onChange={() => {}}
      />
    </div>
  )
}

export function Optional() {
  return (
    <div className="max-w-md">
      <FieldRow
        field={{
          name: "notes",
          label: "Notes",
          kind: "textarea",
          placeholder: "Anything the reviewer should know",
        }}
        value=""
        onChange={() => {}}
      />
    </div>
  )
}
