import { PlusIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Navigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import type { Option } from "@/components/form/types"
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
import { useUrlFilters } from "@/lib/useUrlFilters"
import type { ConfigRow } from "@/modules/config/api"
import { ConfigEntityDialog } from "@/modules/config/ConfigEntityDialog"
import { configEntities, findEntity, type LookupMap } from "@/modules/config/descriptors"
import { useConfigList, useLookup, useSaveEntity, useSetActive } from "@/modules/config/queries"

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

  const params = {
    ...(includeInactive ? { include_inactive: true } : {}),
    ...(descriptor.filterField !== undefined && filterValue !== ""
      ? { category_id: filterValue }
      : {}),
  }

  const list = useConfigList(descriptor, params)
  const save = useSaveEntity(descriptor)
  const setActive = useSetActive(descriptor)

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
              className="h-8 w-52 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
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
          className="aria-pressed:border-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
        >
          Show inactive
        </Button>

        <span className="ml-auto text-sm text-muted-foreground">
          <span className="numeric text-foreground">{rows.length}</span>{" "}
          {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
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
              <TableHead className="w-44 text-right">
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
              rows.map((row) => (
                <TableRow key={row.id} className={row.is_active ? "" : "opacity-60"}>
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
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
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
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
    </div>
  )
}
