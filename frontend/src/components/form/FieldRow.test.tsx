import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FieldRow } from "@/components/form/FieldRow"
import type { FormField, Option } from "@/components/form/types"

const OPTIONS: Option[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
]

function renderField(field: Partial<FormField> & { kind: FormField["kind"] }, value = "") {
  render(
    <FieldRow
      field={{ name: "field", label: "Field", ...field }}
      value={value}
      options={OPTIONS}
      onChange={() => {}}
    />,
  )
  // Optional fields carry "(optional)" in their accessible name, so match on
  // the prefix rather than the whole string.
  return screen.getByLabelText(/^Field/)
}

describe("FieldRow input types", () => {
  // Pins the whole map rather than only the newest entry: the branch is one long
  // ternary, so adding to it is exactly how an existing kind gets displaced.
  it.each([
    ["text", "text"],
    ["number", "number"],
    ["password", "password"],
    ["email", "email"],
    ["date", "date"],
    ["datetime", "datetime-local"],
  ] as const)("renders %s as an input of type %s", (kind, expected) => {
    expect(renderField({ kind })).toHaveAttribute("type", expected)
  })

  it("still renders textarea as its own element", () => {
    expect(renderField({ kind: "textarea" }).tagName).toBe("TEXTAREA")
  })

  it("still renders select as its own element", () => {
    expect(renderField({ kind: "select" }).tagName).toBe("SELECT")
  })
})

describe("FieldRow required marking", () => {
  // Required is the app-wide default, so only the exceptions are labelled.
  it("marks an optional field and leaves a required one unmarked", () => {
    render(
      <div>
        <FieldRow
          field={{ name: "needed", label: "Needed", kind: "text", required: true }}
          value=""
          onChange={() => {}}
        />
        <FieldRow
          field={{ name: "spare", label: "Spare", kind: "text" }}
          value=""
          onChange={() => {}}
        />
      </div>,
    )

    expect(screen.getByLabelText("Needed")).toBeInTheDocument()
    expect(screen.getByLabelText("Spare (optional)")).toBeInTheDocument()
  })

  it("never renders an asterisk marker", () => {
    renderField({ kind: "text", required: true })
    expect(screen.queryByText("*")).toBeNull()
  })

  it("keeps aria-required carrying the requirement for assistive tech", () => {
    expect(renderField({ kind: "text", required: true })).toHaveAttribute(
      "aria-required",
      "true",
    )
  })
})

describe("FieldRow select placeholder", () => {
  function optionValues(select: HTMLElement) {
    return Array.from(select.querySelectorAll("option")).map((o) => o.value)
  }

  it("offers the placeholder on a required select while nothing is chosen", () => {
    const select = renderField({ kind: "select", required: true }, "")
    expect(optionValues(select)).toEqual(["", "a", "b"])
    expect(screen.getByRole("option", { name: "Choose one" })).toBeInTheDocument()
  })

  // A required select must not let the user fall back to an empty value once a
  // real one is set.
  it("drops the placeholder on a required select once a value is chosen", () => {
    const select = renderField({ kind: "select", required: true }, "a")
    expect(optionValues(select)).toEqual(["a", "b"])
    expect(screen.queryByRole("option", { name: "Choose one" })).toBeNull()
  })

  // A stale id must not silently resolve to whichever option happens to be
  // first — the placeholder stays so the field reads as unset.
  it("keeps the placeholder when the value matches no option", () => {
    const select = renderField({ kind: "select", required: true }, "gone")
    expect(optionValues(select)).toEqual(["", "a", "b"])
  })

  it("always keeps None on an optional select, chosen or not", () => {
    expect(optionValues(renderField({ kind: "select" }, ""))).toEqual(["", "a", "b"])
    expect(optionValues(renderField({ kind: "select" }, "a"))).toEqual(["", "a", "b"])
  })
})
