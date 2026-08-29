import { PencilIcon, Trash2Icon, UsersIcon } from "lucide-react"
import {
  RowActions,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "kinetilearn-frontend"

const actions = [
  { label: "Edit class", icon: PencilIcon, onSelect: () => {} },
  { label: "Manage enrolment", icon: UsersIcon, to: "/admin/classes/1" },
  { label: "Delete class", icon: Trash2Icon, destructive: true, onSelect: () => {} },
]

export function InTableRow() {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Class</TableHead>
          <TableHead className="w-12 text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="font-medium">Onboarding — Engineering</TableCell>
          <TableCell className="text-right">
            <RowActions label="Onboarding — Engineering" actions={actions} />
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="font-medium">Security awareness 2026</TableCell>
          <TableCell className="text-right">
            <RowActions label="Security awareness 2026" actions={actions} />
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
