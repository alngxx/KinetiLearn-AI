import { ChartSplineIcon, CircleCheckIcon, CircleSlashIcon, PencilIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import type { Option } from "@/components/form/types"
import { PageHeader } from "@/components/PageHeader"
import { RowActions } from "@/components/RowActions"
import { QueryErrorState } from "@/components/QueryErrorState"
import { StatusBadge } from "@/components/StatusBadge"
import { Badge } from "@/components/ui/badge"
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
import { useUrlFilters } from "@/lib/useUrlFilters"
import type { LookupRow, UserRow } from "@/modules/users/api"
import { UserFormDialog } from "@/modules/users/UserFormDialog"
import { useSaveUser, useSetUserActive, useUserLookups, useUsers } from "@/modules/users/queries"

const ROLE_OPTIONS: Option[] = [
  { value: "learner", label: "Learner" },
  { value: "admin", label: "Admin" },
]

function toOptions(rows: LookupRow[]): Option[] {
  return rows.map((row) => ({ value: row.id, label: row.name }))
}

function nameFor(rows: LookupRow[], id: string | null | undefined) {
  if (id === null || id === undefined) return null
  return rows.find((row) => row.id === id)?.name ?? null
}

// The API has no job_position_id filter, so it is not offered as one.
const FILTER_KEYS = ["role", "department_id", "seniority_id", "employee_level_id"] as const

const FILTERS: { name: (typeof FILTER_KEYS)[number]; label: string; optionsFrom: string }[] = [
  { name: "role", label: "Role", optionsFrom: "roles" },
  { name: "department_id", label: "Department", optionsFrom: "departments" },
  { name: "seniority_id", label: "Seniority", optionsFrom: "seniority_levels" },
  { name: "employee_level_id", label: "Employee level", optionsFrom: "employee_levels" },
]

export function UsersPage() {
  const { values: filters, setFilter } = useUrlFilters(FILTER_KEYS)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirming, setConfirming] = useState<UserRow | null>(null)

  const lookups = useUserLookups()
  const list = useUsers(filters)
  const save = useSaveUser()
  const setActive = useSetUserActive()

  const options: Record<string, Option[]> = {
    roles: ROLE_OPTIONS,
    departments: toOptions(lookups.departments),
    seniority_levels: toOptions(lookups.seniority_levels),
    job_positions: toOptions(lookups.job_positions),
    employee_levels: toOptions(lookups.employee_levels),
  }

  async function handleSave(id: string | undefined, body: Record<string, unknown>) {
    await save.mutateAsync({ id, body })
    toast.success(id === undefined ? "Person created" : "Changes saved")
  }

  function handleSetActive(row: UserRow, active: boolean) {
    setActive.mutate(
      { id: row.id, active },
      {
        onSuccess: () =>
          toast.success(active ? `${row.full_name} activated` : `${row.full_name} deactivated`),
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
        title="Users"
        description="Everyone with access to the platform, admins and learners alike."
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <PlusIcon />
            New person
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        {FILTERS.map((filter) => (
          <div key={filter.name} className="flex flex-col gap-1.5">
            <label htmlFor={`filter-${filter.name}`} className="label-micro">
              {filter.label}
            </label>
            <select
              id={`filter-${filter.name}`}
              value={filters[filter.name] ?? ""}
              onChange={(event) => setFilter(filter.name, event.target.value)}
              className="h-8 w-44 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/75 dark:bg-input/30"
            >
              <option value="">All</option>
              {options[filter.optionsFrom].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}

        <span className="ml-auto text-sm text-muted-foreground">
          <span className="numeric text-foreground">{rows.length}</span>{" "}
          {rows.length === 1 ? "person" : "people"}
        </span>
      </div>

      <div className="overflow-hidden surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <span className="label-micro">Name</span>
              </TableHead>
              <TableHead>
                <span className="label-micro">Role</span>
              </TableHead>
              <TableHead>
                <span className="label-micro">Tags</span>
              </TableHead>
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
                  colSpan={5}
                  className="py-10 text-center text-muted-foreground"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : list.isError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center">
                  <QueryErrorState
                    title="Could not load people"
                    error={list.error}
                    retrying={list.isFetching}
                    onRetry={() => void list.refetch()}
                  />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No one matches</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Clear the filters, or add someone new.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, index) => {
                const tags = [
                  nameFor(lookups.departments, row.department_id),
                  nameFor(lookups.seniority_levels, row.seniority_id),
                  nameFor(lookups.job_positions, row.job_position_id),
                  nameFor(lookups.employee_levels, row.employee_level_id),
                ].filter((tag): tag is string => tag !== null)

                return (
                  <TableRow
                    key={row.id}
                    style={staggerStyle(index)}
                    className={`enter-stagger ${row.is_active ? "" : "opacity-60"}`}
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{row.full_name}</span>
                        <span className="text-xs text-muted-foreground">{row.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.role === "admin" ? "default" : "secondary"}>
                        {ROLE_OPTIONS.find((option) => option.value === row.role)?.label ?? row.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {tags.length === 0 ? (
                        <span className="text-muted-foreground">Untagged</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {tags.map((tag) => (
                            <Badge key={tag} variant="outline">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge active={row.is_active} />
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        label={row.full_name}
                        actions={[
                          {
                            label: "Skills",
                            icon: ChartSplineIcon,
                            to: `/admin/users/${row.id}/skills`,
                          },
                          {
                            label: "Edit",
                            icon: PencilIcon,
                            onSelect: () => {
                              setEditing(row)
                              setDialogOpen(true)
                            },
                          },
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
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {dialogOpen && (
        <UserFormDialog
          key={editing?.id ?? "new"}
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
        title={`Deactivate ${confirming?.full_name}?`}
        description="They lose access immediately and stop receiving classes and daily quizzes. You can activate them again later."
        confirmLabel="Deactivate"
        onConfirm={() => {
          if (confirming !== null) handleSetActive(confirming, false)
          setConfirming(null)
        }}
      />
    </div>
  )
}
