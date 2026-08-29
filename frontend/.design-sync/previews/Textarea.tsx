import { Label, Textarea } from "kinetilearn-frontend"

export function Default() {
  return (
    <div className="flex max-w-md flex-col gap-1.5">
      <Label htmlFor="q-body">Question</Label>
      <Textarea
        id="q-body"
        rows={4}
        defaultValue="Explain how the retention policy applies to documents that failed processing."
      />
    </div>
  )
}

export function States() {
  return (
    <div className="flex max-w-md flex-col gap-4">
      <Textarea placeholder="Add a note for the reviewer…" rows={3} />
      <Textarea defaultValue="Locked after publishing." rows={2} disabled />
    </div>
  )
}
