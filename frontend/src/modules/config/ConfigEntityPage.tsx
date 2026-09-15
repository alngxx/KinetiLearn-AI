import { CircleCheckIcon, CircleSlashIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"
import { Navigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import type { Option } from "@/components/form/types"
import { PageHeader } from "@/components/PageHeader"
import { RowActions } from "@/components/RowActions"
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
import { staggerStyle } from "@/lib/stagger"
import { useClampedText } from "@/lib/useClampedText"
import { useUrlFilters } from "@/lib/useUrlFilters"
import type { ConfigRow } from "@/modules/config/api"
import { ConfigEntityDialog } from "@/modules/config/ConfigEntityDialog"
import {
  configEntities,
  findEntity,
  type ConfigEntityDescriptor,
  type LookupMap,
} from "@/modules/config/descriptors"
import {
  useConfigList,
  useDeleteEntity,
  useLookup,
  useSaveEntity,
  useSetActive,
} from "@/modules/config/queries"

export function ConfigEntityPage() {
  const { entityKey } = useParams()
  const descriptor = findEntity(entityKey)

  if (descriptor === undefined) {
    return <Navigate to={`/admin/config/${configEntities[0].key}`} replace />
  }
  // Remount on entity change so filters and dialog state never leak across pages.
  return <EntityView key={descriptor.key} descriptorKey={descriptor.key} />
}

const FILTER_KEYS = ["category_id", "inactive"] as const

function EntityView({ descriptorKey }: { descriptorKey: string }) {
  const descriptor = findEntity(descriptorKey)!

  const { values: filterValues, setFilter } = useUrlFilters(FILTER_KEYS)
  const includeInactive = filterValues.inactive === "1"
  const filterValue = filterValues.category_id
  const [editing, setEditing] = useState<ConfigRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirming, setConfirming] = useState<ConfigRow | null>(null)
  const [deleting, setDeleting] = useState<ConfigRow | null>(null)

  const params = {
    ...(includeInactive ? { include_inactive: true } : {}),
    ...(descriptor.filterField !== undefined && filterValue !== ""
      ? { category_id: filterValue }
      : {}),
  }

  const list = useConfigList(descriptor, params)
  const save = useSaveEntity(descriptor)
  const setActive = useSetActive(descriptor)
  const remove = useDeleteEntity(descriptor)

  // Only skills declares a lookup today; the rest resolve to null and skip it.
  const needsCategories = useMemo(() => {
    const sources = [
      ...descriptor.formFields.map((field) => field.optionsFrom),
      descriptor.filterField?.optionsFrom,
    ]
    return sources.includes("categories")
  }, [descriptor])

  const categories = useLookup(needsCategories ? "categories" : null)
  const categoryRows = categories.data ?? []

  const lookups: LookupMap = { categories: categoryRows }
  const options: Record<string, Option[]> = {
    categories: categoryRows.map((row) => ({ value: row.id, label: row.name })),
  }

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(row: ConfigRow) {
    setEditing(row)
    setDialogOpen(true)
  }

  async function handleSave(id: string | undefined, body: Record<string, unknown>) {
    await save.mutateAsync({ id, body })
    toast.success(id === undefined ? `${descriptor.singular} created` : `${descriptor.singular} saved`)
  }

  function handleSetActive(row: ConfigRow, active: boolean) {
    setActive.mutate(
      { row, active },
      {
        onSuccess: () => toast.success(active ? `${row.name} activated` : `${row.name} deactivated`),
        // Deactivating can be refused — a category with active skills, for one —
        // and there is no form open to put that message in.
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not change the status."),
      },
    )
  }

  function handleDelete(row: ConfigRow) {
    remove.mutate(
      { id: row.id },
      {
        onSuccess: () => toast.success(`${row.name} deleted`),
        // A 409 here means a skill is still assigned to this category — that
        // sentence is the whole answer, so it's shown as-is.
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : `Could not delete this ${descriptor.singular.toLowerCase()}.`),
      },
    )
  }

  const rows = list.data ?? []
  const columnCount = descriptor.columns.length + 2

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Configuration"
        title={descriptor.label}
        description={descriptor.description}
        actions={
          <Button onClick={openCreate}>
            <PlusIcon />
            New {descriptor.singular.toLowerCase()}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        {descriptor.filterField !== undefined && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="entity-filter" className="label-micro">
              {descriptor.filterField.label}
            </label>
            <select
              id="entity-filter"
              value={filterValue}
              onChange={(event) => setFilter("category_id", event.target.value)}
              className="h-8 w-52 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/75 dark:bg-input/30"
            >
              <option value="">All categories</option>
              {options.categories.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}

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
          {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {descriptor.layout === "cards" ? (
        <CardList
          descriptor={descriptor}
          list={list}
          rows={rows}
          onEdit={openEdit}
          onSetActive={(row, active) =>
            active ? handleSetActive(row, true) : setConfirming(row)
          }
          activePending={setActive.isPending}
          onDelete={setDeleting}
          deletePending={remove.isPending}
        />
      ) : (
        <div className="overflow-hidden surface">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {descriptor.columns.map((column) => (
                  <TableHead key={column.key} className={column.className}>
                    <span className="label-micro">{column.header}</span>
                  </TableHead>
                ))}
                <TableHead className="w-28">
                  <span className="label-micro">Status</span>
                </TableHead>
                <TableHead className="w-12 text-right">
                  <span className="label-micro">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isPending ? (
                <TableRow>
                  <TableCell
                    role="status"
                    colSpan={columnCount}
                    className="py-10 text-center text-muted-foreground"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              ) : list.isError ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="py-10 text-center">
                    <QueryErrorState
                      title={`Could not load ${descriptor.label.toLowerCase()}`}
                      error={list.error}
                      retrying={list.isFetching}
                      onRetry={() => void list.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-12 text-center">
                    <p className="text-sm font-medium text-foreground">
                      Nothing here yet
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add the first {descriptor.singular.toLowerCase()} to get started.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow
                    key={row.id}
                    style={staggerStyle(index)}
                    className={`enter-stagger ${row.is_active ? "" : "opacity-60"}`}
                  >
                    {descriptor.columns.map((column) => (
                      <TableCell key={column.key} className={column.className}>
                        {column.render === undefined ? (
                          <span className="font-medium">
                            {String((row as Record<string, unknown>)[column.key] ?? "")}
                          </span>
                        ) : (
                          column.render(row, lookups)
                        )}
                      </TableCell>
                    ))}
                    <TableCell>
                      <StatusBadge active={row.is_active} />
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        label={row.name}
                        inlineAction={{ label: "Edit", icon: PencilIcon, onSelect: () => openEdit(row) }}
                        actions={[
                          {
                            label: row.is_active ? "Deactivate" : "Activate",
                            icon: row.is_active ? CircleSlashIcon : CircleCheckIcon,
                            disabled: setActive.isPending,
                            onSelect: () =>
                              row.is_active ? setConfirming(row) : handleSetActive(row, true),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {dialogOpen && (
        <ConfigEntityDialog
          key={editing?.id ?? "new"}
          descriptor={descriptor}
          row={editing}
          options={options}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
        title={`Deactivate ${confirming?.name}?`}
        description={`It stops being available for new work and disappears from this list unless you show inactive entries. You can activate it again later.`}
        confirmLabel="Deactivate"
        onConfirm={() => {
          if (confirming !== null) handleSetActive(confirming, false)
          setConfirming(null)
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete ${deleting?.name} permanently?`}
        description="This can't be undone. If any skill is still assigned to this category, the delete is refused — reassign or delete those skills first."
        confirmLabel="Delete permanently"
        confirmVariant="destructive"
        onConfirm={() => {
          if (deleting !== null) handleDelete(deleting)
          setDeleting(null)
        }}
      />
    </div>
  )
}

function CardList({
  descriptor,
  list,
  rows,
  onEdit,
  onSetActive,
  activePending,
  onDelete,
  deletePending,
}: {
  descriptor: ConfigEntityDescriptor
  list: ReturnType<typeof useConfigList>
  rows: ConfigRow[]
  onEdit: (row: ConfigRow) => void
  onSetActive: (row: ConfigRow, active: boolean) => void
  activePending: boolean
  onDelete: (row: ConfigRow) => void
  deletePending: boolean
}) {
  if (list.isPending) {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted-foreground">
        Loading…
      </p>
    )
  }

  if (list.isError) {
    return (
      <div className="surface py-10">
        <QueryErrorState
          title={`Could not load ${descriptor.label.toLowerCase()}`}
          error={list.error}
          retrying={list.isFetching}
          onRetry={() => void list.refetch()}
        />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="surface py-12 text-center">
        <p className="text-sm font-medium text-foreground">Nothing here yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add the first {descriptor.singular.toLowerCase()} to get started.
        </p>
      </div>
    )
  }

  return (
    <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row, index) => (
        <ConfigCard
          key={row.id}
          row={row}
          index={index}
          onEdit={() => onEdit(row)}
          onSetActive={(active) => onSetActive(row, active)}
          activePending={activePending}
          deletable={descriptor.deletable === true}
          onDelete={() => onDelete(row)}
          deletePending={deletePending}
        />
      ))}
    </ul>
  )
}

function ConfigCard({
  row,
  index,
  onEdit,
  onSetActive,
  activePending,
  deletable,
  onDelete,
  deletePending,
}: {
  row: ConfigRow
  index: number
  onEdit: () => void
  onSetActive: (active: boolean) => void
  activePending: boolean
  deletable: boolean
  onDelete: () => void
  deletePending: boolean
}) {
  const description = row.description ?? ""
  const name = useClampedText<HTMLHeadingElement>(row.name, 2)
  const body = useClampedText<HTMLParagraphElement>(description, 2)

  return (
    <li
      style={staggerStyle(index)}
      className={`surface enter-stagger flex flex-col gap-3 p-5 ${row.is_active ? "" : "opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* The visible text is trimmed to what fits, so the full name is carried
            on aria-label instead — which a heading is named by and a bare span
            would not be. */}
        <h2
          ref={name.ref}
          title={row.name}
          aria-label={row.name}
          className="max-h-[2lh] min-w-0 overflow-hidden font-medium"
        >
          {name.text}
        </h2>
        <StatusBadge active={row.is_active} />
      </div>

      {/* An empty description keeps the table's em dash rather than dropping the
          line, so a card without one still reads as a filled-in record. The dash
          is a placeholder for the eye only — read aloud it is noise, and in the
          table the column header carried the meaning it has lost here. */}
      {description === "" ? (
        <p aria-hidden="true" className="text-xs text-muted-foreground">
          —
        </p>
      ) : (
        <p
          ref={body.ref}
          title={description}
          className="max-h-[2lh] overflow-hidden text-xs text-muted-foreground"
        >
          {body.text}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end">
        <RowActions
          label={row.name}
          inlineAction={{ label: "Edit", icon: PencilIcon, onSelect: onEdit }}
          actions={[
            {
              label: row.is_active ? "Deactivate" : "Activate",
              icon: row.is_active ? CircleSlashIcon : CircleCheckIcon,
              disabled: activePending,
              onSelect: () => onSetActive(!row.is_active),
            },
            ...(deletable
              ? [
                  {
                    label: "Delete",
                    icon: Trash2Icon,
                    destructive: true,
                    disabled: deletePending,
                    onSelect: onDelete,
                  },
                ]
              : []),
          ]}
        />
      </div>
    </li>
  )
}
