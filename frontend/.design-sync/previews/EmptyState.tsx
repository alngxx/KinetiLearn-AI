import { FileTextIcon, InboxIcon } from "lucide-react"
import { EmptyState } from "kinetilearn-frontend"

export function NoDocuments() {
  return (
    <EmptyState
      icon={FileTextIcon}
      title="No documents yet"
      body="Upload a PDF or Word file and it will be processed for the chatbot and the exam generator."
    />
  )
}

export function NoSubmissions() {
  return (
    <EmptyState
      icon={InboxIcon}
      title="Nothing submitted"
      body="Learner submissions appear here once the exam has been published to a class."
    />
  )
}
