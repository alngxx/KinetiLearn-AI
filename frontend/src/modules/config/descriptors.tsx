import type { ReactNode } from "react"
import type { FormField, FormValues } from "@/components/form/types"
import type { ConfigRow } from "@/modules/config/api"
import { ThresholdLadder } from "@/modules/config/ThresholdLadder"

export type LookupKey = "categories"

export type LookupMap = Record<LookupKey, ConfigRow[]>

export type Column = {
  key: string
  header: string
  className?: string
  render?: (row: ConfigRow, lookups: LookupMap) => ReactNode
}

export type ConfigEntityDescriptor = {
  key: string
  label: string
  singular: string
  description: string
  basePath: string
  columns: Column[]
  formFields: FormField[]
  filterField?: FormField
  validate?: (values: FormValues) => Record<string, string>
}

// The backend rejects anything outside this on every *Update schema. Job
// positions and employee levels allow more on create, but applying the strict
// rule everywhere stops the UI minting names its own edit form cannot save.
const NAME_PATTERN = /^[a-zA-Z0-9]+$/
const NAME_PATTERN_MESSAGE = "Letters and numbers only — no spaces or punctuation."

function nameField(maxLength: number): FormField {
  return {
    name: "name",
    label: "Name",
    kind: "text",
    required: true,
    pattern: NAME_PATTERN,
    patternMessage: NAME_PATTERN_MESSAGE,
    maxLength,
  }
}

const descriptionField: FormField = {
  name: "description",
  label: "Description",
  kind: "textarea",
  placeholder: "What this is for, in a sentence.",
}

const rankField: FormField = {
  name: "rank",
  label: "Rank",
  kind: "number",
  required: true,
  helpText: "Lower ranks sort first. Each rank is used once.",
}

const descriptionColumn: Column = {
  key: "description",
  header: "Description",
  className: "min-w-0 max-w-md",
  render: (row) =>
    row.description === null || row.description === undefined || row.description === "" ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className="block break-words whitespace-normal">{row.description}</span>
    ),
}

const rankColumn: Column = {
  key: "rank",
  header: "Rank",
  className: "w-24",
  render: (row) => <span className="numeric">{row.rank}</span>,
}

// Name + description, three times over.
function taxonomyDescriptor(
  key: string,
  label: string,
  singular: string,
  description: string,
): ConfigEntityDescriptor {
  return {
    key,
    label,
    singular,
    description,
    basePath: `/api/v1/config/${key}`,
    columns: [{ key: "name", header: "Name" }, descriptionColumn],
    formFields: [nameField(100), descriptionField],
  }
}

// Name + rank, twice over.
function rankedDescriptor(
  key: string,
  label: string,
  singular: string,
  description: string,
): ConfigEntityDescriptor {
  return {
    key,
    label,
    singular,
    description,
    basePath: `/api/v1/config/${key}`,
    columns: [{ key: "name", header: "Name" }, rankColumn],
    formFields: [nameField(50), rankField],
  }
}

const skillsDescriptor: ConfigEntityDescriptor = {
  key: "skills",
  label: "Skills",
  singular: "Skill",
  description: "What learners are scored on. Each skill sits in a category and sets its own level cut points.",
  basePath: "/api/v1/config/skills",
  columns: [
    { key: "name", header: "Name" },
    {
      key: "category_id",
      header: "Category",
      render: (row, lookups) => {
        const match = lookups.categories.find((item) => item.id === row.category_id)
        return match === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span>{match.name}</span>
        )
      },
    },
    {
      key: "thresholds",
      header: "Level cut points",
      render: (row) => (
        <ThresholdLadder
          basicMax={row.basic_max ?? 0}
          intermediateMax={row.intermediate_max ?? 0}
        />
      ),
    },
  ],
  formFields: [
    {
      name: "category_id",
      label: "Category",
      kind: "select",
      required: true,
      optionsFrom: "categories",
    },
    nameField(100),
    descriptionField,
    {
      name: "basic_max",
      label: "Basic up to",
      kind: "number",
      required: true,
      helpText: "Scores at or below this stay at basic.",
    },
    {
      name: "intermediate_max",
      label: "Intermediate up to",
      kind: "number",
      required: true,
      helpText: "Above this, a learner is advanced.",
    },
  ],
  filterField: {
    name: "category_id",
    label: "Category",
    kind: "select",
    optionsFrom: "categories",
  },
  validate: (values): Record<string, string> => {
    const basic = Number(values.basic_max)
    const intermediate = Number(values.intermediate_max)
    if (Number.isNaN(basic) || Number.isNaN(intermediate)) return {}
    if (intermediate <= basic) {
      return { intermediate_max: "Must be higher than the basic cut point." }
    }
    return {}
  },
}

export const configEntities: ConfigEntityDescriptor[] = [
  taxonomyDescriptor(
    "categories",
    "Categories",
    "Category",
    "Top-level groupings used to organize platform skills.",
  ),
  skillsDescriptor,
  taxonomyDescriptor(
    "departments",
    "Departments",
    "Department",
    "Organizational units used to structure teams and target learning content.",
  ),
  rankedDescriptor(
    "seniority-levels",
    "Seniority Levels",
    "Seniority Level",
    "Career experience tiers ranked for reporting and audience targeting.",
  ),
  taxonomyDescriptor(
    "job-positions",
    "Job Positions",
    "Job Position",
    "Functional job roles assigned to team members across departments.",
  ),
  rankedDescriptor(
    "employee-levels",
    "Employee Levels",
    "Employee Level",
    "Internal career grade levels ranked for reporting and audience targeting.",
  ),
]

export function findEntity(key: string | undefined): ConfigEntityDescriptor | undefined {
  return configEntities.find((entity) => entity.key === key)
}
