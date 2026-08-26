import { PlusIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import type { Option } from "@/components/form/types"
import { PageHeader } from "@/components/PageHeader"
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
import { documentBlockedReason, type DailyQuizConfigRow, type LookupRow } from "@/modules/daily-quiz-configs/api"
import { DailyQuizConfigFormDialog, DEFAULT_TIMEZONE } from "@/modules/daily-quiz-configs/DailyQuizConfigFormDialog"
import { formatPushTime, formatRange } from "@/modules/daily-quiz-configs/dates"
import {
  useDailyQuizConfigs,
  useEligibleDocuments,
  useSaveConfig,
  useSetConfigActive,
  useTargetLookups,
} from "@/modules/daily-quiz-configs/queries"
import { timezoneOptions } from "@/modules/daily-quiz-configs/timezones"

function toOptions(rows: LookupRow[]): Option[] {
  return rows.map((row) => ({ value: row.id, label: row.name }))
}

function nameFor(rows: LookupRow[], id: string | null | undefined) {
  if (id === null || id === undefined) return null
  return rows.find((row) => row.id === id)?.name ?? null
}

export function DailyQuizConfigsPage() {
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<DailyQuizConfigRow | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirming, setConfirming] = useState<DailyQuizConfigRow | null>(null)

  const list = useDailyQuizConfigs(includeInactive)
  const documents = useEligibleDocuments()
  const targetLookups = useTargetLookups()
  const save = useSaveConfig()
  const setActive = useSetConfigActive()

  const eligibleDocuments = (documents.data ?? []).filter(
    (row) => documentBlockedReason(row) === null,
  )
  const blockedCount = (documents.data?.length ?? 0) - eligibleDocuments.length

  const options: Record<string, Option[]> = {
    source_document: eligibleDocuments.map((row) => ({ value: row.document_id, label: row.title })),
    timezone: timezoneOptions(editing?.timezone ?? DEFAULT_TIMEZONE).map((zone) => ({
      value: zone,
      label: zone,
    })),
    departments: toOptions(targetLookups.departments),
    seniority_levels: toOptions(targetLookups.seniority_levels),
    job_positions: toOptions(targetLookups.job_positions),
    employee_levels: toOptions(targetLookups.employee_levels),
  }

  async function handleSave(id: string | undefined, body: Record<string, unknown>) {
    await save.mutateAsync({ id, body })
    toast.success(id === undefined ? "Daily quiz config created" : "Changes saved")
  }

  function handleSetActive(row: DailyQuizConfigRow, active: boolean) {
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
        eyebrow="Daily quiz"
        title="Daily quiz configs"
        description="What each daily quiz covers, when it's pushed, and which learners it reaches."
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <PlusIcon />
            New config
          </Button>
        }
      />

      {blockedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="numeric">{blockedCount}</span>{" "}
          {blockedCount === 1 ? "document isn't" : "documents aren't"} eligible as a source —
          each needs an active version that has finished processing.
        </p>
      )}

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
          {rows.length === 1 ? "config" : "configs"}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <span className="label-micro">Name</span>
              </TableHead>
              <TableHead className="w-56">
                <span className="label-micro">Runs</span>
              </TableHead>
              <TableHead>
                <span className="label-micro">Audience</span>
              </TableHead>
              <TableHead className="w-28">
                <span className="label-micro">Status</span>
              </TableHead>
              <TableHead className="w-40 text-right">
                <span className="label-micro">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : list.isError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center">
                  <QueryErrorState
                    title="Could not load daily quiz configs"
                    error={list.error}
                    retrying={list.isFetching}
                    onRetry={() => void list.refetch()}
                  />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No daily quiz configs yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create one to start pushing daily quizzes to learners.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const tags = [
                  nameFor(targetLookups.departments, row.target_department_id),
                  nameFor(targetLookups.seniority_levels, row.target_seniority_id),
                  nameFor(targetLookups.job_positions, row.target_job_position_id),
                  nameFor(targetLookups.employee_levels, row.target_employee_level_id),
                ].filter((tag): tag is string => tag !== null)

                return (
                  <TableRow key={row.id} className={row.is_active ? "" : "opacity-60"}>
                    <TableCell className="min-w-0 max-w-sm">
                      <span className="font-medium break-words">{row.name}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="numeric text-sm text-muted-foreground">
                          {formatRange(row.start_date, row.end_date)}
                        </span>
                        <span className="numeric text-xs text-muted-foreground">
                          {formatPushTime(row.push_time)} · {row.timezone}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {tags.length === 0 ? (
                        <span className="text-muted-foreground">Everyone</span>
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
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {dialogOpen && (
        <DailyQuizConfigFormDialog
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
        title={`Deactivate ${confirming?.name}?`}
        description="It stops being pushed to learners. The config is kept, so activating it again resumes it on its existing schedule."
        confirmLabel="Deactivate"
        onConfirm={() => {
          if (confirming !== null) handleSetActive(confirming, false)
          setConfirming(null)
        }}
      />
    </div>
  )
}
