import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FieldRow } from "@/components/form/FieldRow"
import type { FormField } from "@/components/form/types"

function renderKind(kind: FormField["kind"]) {
  render(
    <FieldRow
      field={{ name: "field", label: "Field", kind }}
      value=""
      options={[{ value: "a", label: "A" }]}
      onChange={() => {}}
    />,
  )
  return screen.getByLabelText("Field")
}

describe("FieldRow input types", () => {
  // Pins the whole map rather than only the new entry: the branch is one long
  // ternary, so adding to it is exactly how an existing kind gets displaced.
  it.each([
    ["text", "text"],
    ["number", "number"],
    ["password", "password"],
    ["email", "email"],
    ["date", "date"],
    ["datetime", "datetime-local"],
  ] as const)("renders %s as an input of type %s", (kind, expected) => {
    expect(renderKind(kind)).toHaveAttribute("type", expected)
  })

  // Separate cases: two renders in one body would leave two "Field" labels in
  // the same document for getByLabelText to choose between.
  it("still renders textarea as its own element", () => {
    expect(renderKind("textarea").tagName).toBe("TEXTAREA")
  })

  it("still renders select as its own element", () => {
    expect(renderKind("select").tagName).toBe("SELECT")
  })
})
