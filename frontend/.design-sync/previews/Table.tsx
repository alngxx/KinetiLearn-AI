import {
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "kinetilearn-frontend"

const classes = [
  { name: "Onboarding — Engineering", learners: 48, active: true },
  { name: "Security awareness 2026", learners: 132, active: true },
  { name: "Manager essentials", learners: 21, active: false },
]

export function ClassList() {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Class</TableHead>
          <TableHead className="w-28">Learners</TableHead>
          <TableHead className="w-28">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {classes.map((row) => (
          <TableRow key={row.name}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="font-mono">{row.learners}</TableCell>
            <TableCell>
              <StatusBadge active={row.active} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function Empty() {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Class</TableHead>
          <TableHead className="w-28">Learners</TableHead>
          <TableHead className="w-28">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={3} className="py-10 text-center text-sm text-muted-foreground">
            No classes yet
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
