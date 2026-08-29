import { PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "kinetilearn-frontend"

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>Create exam</Button>
      <Button variant="outline">Preview</Button>
      <Button variant="secondary">Duplicate</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="destructive">Delete class</Button>
      <Button variant="link">View report</Button>
    </div>
  )
}

export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  )
}

export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <PlusIcon />
        New class
      </Button>
      <Button variant="destructive">
        <Trash2Icon />
        Remove
      </Button>
      <Button variant="outline" size="icon" aria-label="Add">
        <PlusIcon />
      </Button>
    </div>
  )
}

export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled>Publishing…</Button>
      <Button variant="outline" disabled>
        Preview
      </Button>
      <Button variant="destructive" disabled>
        Delete class
      </Button>
    </div>
  )
}
