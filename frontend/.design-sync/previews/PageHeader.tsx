import { PlusIcon } from "lucide-react"
import { Button, PageHeader } from "kinetilearn-frontend"

export function WithActions() {
  return (
    <PageHeader
      eyebrow="People"
      title="Classes"
      description="Enrol people by department, seniority or employee level"
      actions={
        <Button>
          <PlusIcon />
          New class
        </Button>
      }
    />
  )
}

export function TitleOnly() {
  return <PageHeader eyebrow="Library" title="Documents" />
}

export function WithDescription() {
  return (
    <PageHeader
      eyebrow="Assessment"
      title="Exam generator"
      description="Generate a draft exam from any processed document, then review each question before publishing it to a class."
    />
  )
}
