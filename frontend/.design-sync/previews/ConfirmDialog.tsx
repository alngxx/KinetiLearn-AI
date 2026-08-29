import { ConfirmDialog } from "kinetilearn-frontend"

export function Destructive() {
  return (
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      title="Delete this class?"
      description="Manager essentials and its 21 enrolments will be removed. This cannot be undone."
      confirmLabel="Delete class"
      confirmVariant="destructive"
      onConfirm={() => {}}
    />
  )
}

export function Deactivate() {
  return (
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      title="Deactivate this user?"
      description="They keep their submission history but can no longer sign in."
      confirmLabel="Deactivate"
      onConfirm={() => {}}
    />
  )
}
