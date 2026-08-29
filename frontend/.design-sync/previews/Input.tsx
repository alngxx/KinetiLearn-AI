import { Input, Label } from "kinetilearn-frontend"

export function Default() {
  return (
    <div className="flex max-w-sm flex-col gap-1.5">
      <Label htmlFor="class-name">Class name</Label>
      <Input id="class-name" defaultValue="Onboarding — Engineering" />
    </div>
  )
}

export function States() {
  return (
    <div className="flex max-w-sm flex-col gap-4">
      <Input placeholder="Search documents…" />
      <Input defaultValue="security-policy-2026.pdf" disabled />
      <Input defaultValue="not-an-email" aria-invalid="true" />
    </div>
  )
}
