import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { StatusBadge } from "@/components/StatusBadge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { isApiError } from "@/lib/errors"
import type { ClassRow } from "@/modules/classes/api"
import { ClassFormDialog } from "@/modules/classes/ClassFormDialog"
import { formatRange } from "@/modules/classes/dates"
import {
  useClasses,
  useDeleteClass,
  useSaveClass,
  useSetClassActive,
} from "@/modules/classes/queries"

export function ClassesPage() {
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<ClassRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirming, setConfirming] = useState<ClassRow | null>(null)
  const [deleting, setDeleting] = useState<ClassRow | null>(null)

  const list = useClasses(includeInactive)
  const save = useSaveClass()
  const setActive = useSetClassActive()
  const remove = useDeleteClass()

  async function handleSave(id: string | undefined, body: Record<string, unknown>) {
    await save.mutateAsync({ id, body })
    toast.success(id === undefined ? "Class created" : "Changes saved")
  }

  function handleDelete(row: ClassRow) {
    remove.mutate(
      { id: row.id },
      {
        onSuccess: () => toast.success(`${row.name} deleted`),
        // A 409 means exercises still hang off this class. That sentence names
        // what to clear first, so it is shown as the server wrote it.
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not delete the class."),
      },
    )
  }

  function handleSetActive(row: ClassRow, active: boolean) {
    setActive.mutate(
      { id: row.id, active },
      {
        onSuccess: () =>
          toast.success(active ? `${row.name} activated` : `${row.name} deactivated`),
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not change the status."),
      },
    )
  }

  const rows = list.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="People"
        title="Classes"
        description="Enrol people by department, seniority or employee level"
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <PlusIcon />
            New class
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <Button
          variant="outline"
          aria-pressed={includeInactive}
          onClick={() => setIncludeInactive((current) => !current)}
          className="aria-pressed:border-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
        >
          Show inactive
        </Button>

        <span className="ml-auto text-sm text-muted-foreground">
          <span className="numeric text-foreground">{rows.length}</span>{" "}
          {rows.length === 1 ? "class" : "classes"}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <span className="label-micro">Name</span>
              </TableHead>
              <TableHead className="w-64">
                <span className="label-micro">Runs</span>
              </TableHead>
              <TableHead className="w-28">
                <span className="label-micro">Status</span>
              </TableHead>
              <TableHead className="w-60 text-right">
                <span className="label-micro">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : list.isError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-10 text-center">
                  <QueryErrorState
                    title="Could not load classes"
                    error={list.error}
                    retrying={list.isFetching}
                    onRetry={() => void list.refetch()}
                  />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No classes yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create one to group the people an exercise should reach.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className={row.is_active ? "" : "opacity-60"}>
                  <TableCell className="min-w-0 max-w-md">
                    <div className="flex min-w-0 flex-col">
                      <Link
                        to={`/admin/classes/${row.id}`}
                        className="w-fit font-medium break-words underline-offset-4 transition-colors outline-none hover:text-ring hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {row.name}
                      </Link>
                      {row.description !== null && row.description !== "" && (
                        <span className="text-xs break-words text-muted-foreground">
                          {row.description}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="numeric text-sm text-muted-foreground">
                      {formatRange(row.start_date, row.end_date)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge active={row.is_active} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(row)
                          setDialogOpen(true)
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={setActive.isPending}
                        onClick={() =>
                          row.is_active ? setConfirming(row) : handleSetActive(row, true)
                        }
                      >
                        {row.is_active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={remove.isPending}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleting(row)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {dialogOpen && (
        <ClassFormDialog
          key={editing?.id ?? "new"}
          row={editing}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete ${deleting?.name} permanently?`}
        description="This removes the class and unenrols everyone in it. It cannot be undone. A class that still has exercises cannot be deleted — delete those first, and nothing changes until they are gone."
        confirmLabel="Delete permanently"
        confirmVariant="destructive"
        onConfirm={() => {
          if (deleting !== null) handleDelete(deleting)
          setDeleting(null)
        }}
      />

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={`Deactivate ${confirming?.name}?`}
        description="It disappears from the learners' class list and from this one unless you show inactive classes. Members and exercises are kept, so activating it again restores everything."
        confirmLabel="Deactivate"
        onConfirm={() => {
          if (confirming !== null) handleSetActive(confirming, false)
          setConfirming(null)
        }}
      />
    </div>
  )
}
