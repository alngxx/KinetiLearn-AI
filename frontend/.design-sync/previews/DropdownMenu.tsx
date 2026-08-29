import { PencilIcon, Trash2Icon, UsersIcon } from "lucide-react"
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kinetilearn-frontend"

export function RowMenu() {
  return (
    <DropdownMenu open>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem>
          <PencilIcon />
          Edit class
        </DropdownMenuItem>
        <DropdownMenuItem>
          <UsersIcon />
          Manage enrolment
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <Trash2Icon />
          Delete class
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
