import { ChevronLeftIcon, SparklesIcon, UserPlusIcon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
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
import { BulkEnrollDialog } from "@/modules/classes/BulkEnrollDialog"
import { ClassFormDialog } from "@/modules/classes/ClassFormDialog"
import { formatMoment, formatRange } from "@/modules/classes/dates"
import { useClass, useDeleteClass, useSaveClass } from "@/modules/classes/queries"

export function ClassDetailPage() {
  const { classId } = useParams()
  // The route cannot match without the segment, so this is only for the type.
  return <DetailView key={classId} classId={classId ?? ""} />
}

function DetailView({ classId }: { classId: string }) {
  const navigate = useNavigate()
  const [enrolOpen, setEnrolOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const detail = useClass(classId)
  const save = useSaveClass()
  const remove = useDeleteClass()
  const row = detail.data
  const exercises = row?.exercises ?? []
  const memberCount = row?.member_count ?? 0

  async function handleSave(id: string | undefined, body: Record<string, unknown>) {
    await save.mutateAsync({ id, body })
    toast.success("Changes saved")
  }

  function handleDelete() {
    remove.mutate(
      { id: classId },
      {
        onSuccess: () => {
          toast.success(`${row?.name ?? "Class"} deleted`)
          // The page it was showing no longer exists, so stay off it.
          navigate("/admin/classes")
        },
        // A 409 means exercises still hang off this class. That sentence names
        // what to clear first, so it is shown as the server wrote it.
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not delete the class."),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin/classes"
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" />
        Classes
      </Link>

      <PageHeader
        eyebrow="Class"
        title={row?.name ?? "Class"}
        description={
          row?.description !== null && row?.description !== undefined && row.description !== ""
            ? row.description
            : "Who is in this cohort, and which exercises have been assigned to it."
        }
        actions={
          row === undefined ? undefined : (
            <>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Button>
            </>
          )
        }
      />

      {editOpen && row !== undefined && (
        <ClassFormDialog
          row={row}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${row?.name} permanently?`}
        description="This removes the class and unenrols everyone in it. It cannot be undone. A class that still has exercises cannot be deleted — delete those first, and nothing changes until they are gone."
        confirmLabel="Delete permanently"
        confirmVariant="destructive"
        onConfirm={() => {
          setDeleteOpen(false)
          handleDelete()
        }}
      />

      {detail.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : detail.isError ? (
        <div className="surface py-10">
          <QueryErrorState
            title="Could not load this class"
            error={detail.error}
            retrying={detail.isFetching}
            onRetry={() => void detail.refetch()}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="numeric text-sm text-muted-foreground">
              {formatRange(row?.start_date ?? null, row?.end_date ?? null)}
            </span>
            <StatusBadge active={row?.is_active ?? false} />
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="label-micro">Members</h2>
            <div className="flex flex-wrap items-center justify-between gap-4 surface p-5">
              <div className="flex flex-col gap-1">
                <p className="flex items-baseline gap-2">
                  <span className="numeric text-2xl font-semibold text-foreground">
                    {memberCount}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {memberCount === 1 ? "person enrolled" : "people enrolled"}
                  </span>
                </p>
                <p className="max-w-prose text-sm text-muted-foreground">
                  People are added in bulk by department, seniority and employee level. Anyone
                  already here is skipped.
                </p>
              </div>
              <Button onClick={() => setEnrolOpen(true)}>
                <UserPlusIcon />
                Bulk enrol
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="label-micro">Exercises</h2>
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  <span className="numeric text-foreground">{exercises.length}</span>{" "}
                  {exercises.length === 1 ? "exercise" : "exercises"}
                </span>
                <Button variant="outline" asChild>
                  <Link to={`/admin/classes/${classId}/exercises/new`}>
                    <SparklesIcon />
                    Generate exam
                  </Link>
                </Button>
              </div>
            </div>

            <div className="overflow-hidden surface">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>
                      <span className="label-micro">Title</span>
                    </TableHead>
                    <TableHead className="w-52">
                      <span className="label-micro">Opens</span>
                    </TableHead>
                    <TableHead className="w-52">
                      <span className="label-micro">Closes</span>
                    </TableHead>
                    <TableHead className="w-28">
                      <span className="label-micro">State</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exercises.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-12 text-center">
                        <p className="text-sm font-medium text-foreground">No exercises yet</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Generate one from this class&rsquo;s documents to get started.
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    exercises.map((exercise) => (
                      <TableRow key={exercise.id}>
                        <TableCell className="min-w-0 max-w-md break-words">
                          <Link
                            to={`/admin/classes/${classId}/exercises/${exercise.id}`}
                            className="font-medium underline-offset-4 transition-colors outline-none hover:text-ring hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            {exercise.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="numeric text-sm text-muted-foreground">
                            {formatMoment(exercise.start_time)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="numeric text-sm text-muted-foreground">
                            {formatMoment(exercise.end_time)}
                          </span>
                        </TableCell>
                        {/* Not StatusBadge: an exercise with is_active false is
                            one learners cannot see yet, which "Inactive" would
                            misdescribe. */}
                        <TableCell>
                          <Badge variant={exercise.is_active ? "success" : "outline"}>
                            {exercise.is_active ? "Live" : "Draft"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}

      {enrolOpen && (
        <BulkEnrollDialog
          classId={classId}
          classTitle={row?.name ?? "this class"}
          open={enrolOpen}
          onOpenChange={setEnrolOpen}
        />
      )}
    </div>
  )
}
