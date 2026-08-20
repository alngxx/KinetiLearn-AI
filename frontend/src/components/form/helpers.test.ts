import { describe, expect, it } from "vitest"
import { fieldFromConflict } from "@/components/form/helpers"
import type { FormField } from "@/components/form/types"

// Field order matters: fieldFromConflict scans in the order the form renders.
const skillFields: FormField[] = [
  { name: "category_id", label: "Category", kind: "select", required: true },
  { name: "name", label: "Name", kind: "text", required: true },
  { name: "description", label: "Description", kind: "textarea" },
  { name: "basic_max", label: "Basic up to", kind: "number", required: true },
  { name: "intermediate_max", label: "Intermediate up to", kind: "number", required: true },
]

const rankedFields: FormField[] = [
  { name: "name", label: "Name", kind: "text", required: true },
  { name: "rank", label: "Rank", kind: "number", required: true },
]

const userFields: FormField[] = [
  { name: "email", label: "Email", kind: "email", required: true },
  { name: "full_name", label: "Full name", kind: "text", required: true },
]

describe("fieldFromConflict", () => {
  // Messages below are copied verbatim from the running API.
  it("maps a duplicate skill name to the name field, not the category select", () => {
    expect(fieldFromConflict("Skill name already exists in this category.", skillFields)).toBe(
      "name",
    )
  })

  it("maps a duplicate category name to the name field", () => {
    expect(fieldFromConflict("Category name already exists.", skillFields)).toBe("name")
  })

  it("tells a duplicate rank apart from a duplicate name", () => {
    expect(fieldFromConflict("Seniority level rank already exists.", rankedFields)).toBe("rank")
    expect(fieldFromConflict("Seniority level name already exists.", rankedFields)).toBe("name")
  })

  it("maps a duplicate email to the email field", () => {
    expect(fieldFromConflict("Email already exists", userFields)).toBe("email")
  })

  it("returns null when no field is named", () => {
    expect(fieldFromConflict("Something else went wrong.", rankedFields)).toBeNull()
  })
})
