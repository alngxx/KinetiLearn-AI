import { CircleCheckIcon, CircleSlashIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHeader } from "@/components/PageHeader"
import { RowActions } from "@/components/RowActions"
import { QueryErrorState } from "@/components/QueryErrorState"
import { StatusBadge } from "@/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { isApiError } from "@/lib/errors"
import { staggerStyle } from "@/lib/stagger"
import { useClampedText } from "@/lib/useClampedText"
import { useUrlFilters } from "@/lib/useUrlFilters"
import type { ClassRow } from "@/modules/classes/api"
import { ClassFormDialog } from "@/modules/classes/ClassFormDialog"
import { formatRange } from "@/modules/classes/dates"
import {
  useClasses,
  useDeleteClass,
  useSaveClass,
  useSetClassActive,
} from "@/modules/classes/queries"

const FILTER_KEYS = ["inactive"] as const

export function ClassesPage() {
  const { values: filterValues, setFilter } = useUrlFilters(FILTER_KEYS)
  const includeInactive = filterValues.inactive === "1"
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
          onClick={() => setFilter("inactive", includeInactive ? "" : "1")}
          className="aria-pressed:border-ring/40 aria-pressed:bg-accent/40 aria-pressed:text-accent-foreground"
        >
          Show inactive
        </Button>

        <span className="ml-auto text-sm text-muted-foreground">
          <span className="numeric text-foreground">{rows.length}</span>{" "}
          {rows.length === 1 ? "class" : "classes"}
        </span>
      </div>

      {list.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : list.isError ? (
        <div className="surface py-10">
          <QueryErrorState
            title="Could not load classes"
            error={list.error}
            retrying={list.isFetching}
            onRetry={() => void list.refetch()}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="surface py-12 text-center">
          <p className="text-sm font-medium text-foreground">No classes yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one to group the people an exercise should reach.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row, index) => (
            <ClassCard
              key={row.id}
              row={row}
              index={index}
              onEdit={() => {
                setEditing(row)
                setDialogOpen(true)
              }}
              onSetActive={(active) => (active ? handleSetActive(row, true) : setConfirming(row))}
              onDelete={() => setDeleting(row)}
              activePending={setActive.isPending}
              deletePending={remove.isPending}
            />
          ))}
        </ul>
      )}

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

function ClassCard({
  row,
  index,
  onEdit,
  onSetActive,
  onDelete,
  activePending,
  deletePending,
}: {
  row: ClassRow
  index: number
  onEdit: () => void
  onSetActive: (active: boolean) => void
  onDelete: () => void
  activePending: boolean
  deletePending: boolean
}) {
  const name = useClampedText<HTMLAnchorElement>(row.name, 2)
  const description = useClampedText<HTMLParagraphElement>(row.description ?? "", 2)

  return (
    <li
      style={staggerStyle(index)}
      className={`surface enter-stagger flex flex-col gap-3 p-5 ${row.is_active ? "" : "opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          ref={name.ref}
          to={`/admin/classes/${row.id}`}
          title={row.name}
          aria-label={row.name}
          className="max-h-[2lh] min-w-0 overflow-hidden font-medium underline-offset-4 transition-colors outline-none hover:text-ring hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/75"
        >
          {name.text}
        </Link>
        <StatusBadge active={row.is_active} />
      </div>

      {row.description !== null && row.description !== "" && (
        <p
          ref={description.ref}
          title={row.description}
          className="max-h-[2lh] overflow-hidden text-xs text-muted-foreground"
        >
          {description.text}
        </p>
      )}

      <span className="numeric mt-auto text-sm text-muted-foreground">
        {formatRange(row.start_date, row.end_date)}
      </span>

      <div className="flex items-center justify-end">
        <RowActions
          label={row.name}
          inlineAction={{
            label: "Edit",
            icon: PencilIcon,
            onSelect: onEdit,
          }}
          actions={[
            {
              label: row.is_active ? "Deactivate" : "Activate",
              icon: row.is_active ? CircleSlashIcon : CircleCheckIcon,
              disabled: activePending,
              onSelect: () => onSetActive(!row.is_active),
            },
            {
              label: "Delete",
              icon: Trash2Icon,
              destructive: true,
              disabled: deletePending,
              onSelect: onDelete,
            },
          ]}
        />
      </div>
    </li>
  )
}
