import { Input, Label } from "kinetilearn-frontend"

export function WithField() {
  return (
    <div className="flex max-w-sm flex-col gap-1.5">
      <Label htmlFor="pass-mark">Pass mark</Label>
      <Input id="pass-mark" type="number" defaultValue="70" />
    </div>
  )
}

export function Optional() {
  return (
    <div className="flex max-w-sm flex-col gap-1.5">
      <Label htmlFor="notes" className="text-sm font-medium">
        Notes
        <span className="font-normal text-muted-foreground"> (optional)</span>
      </Label>
      <Input id="notes" placeholder="Anything the reviewer should know" />
    </div>
  )
}
