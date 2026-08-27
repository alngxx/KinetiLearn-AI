import { ChevronLeftIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
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
import type { DocumentVersion } from "@/modules/documents/api"
import { DocumentEditDialog } from "@/modules/documents/DocumentEditDialog"
import { ProcessingBadge } from "@/modules/documents/ProcessingBadge"
import {
  useDeleteDocument,
  useDocument,
  useDocumentLookups,
  usePromoteVersion,
  useReprocessVersion,
  useSaveDocument,
  useSetDocumentSkill,
} from "@/modules/documents/queries"

const megabytes = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const kilobytes = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${megabytes.format(mb)}\u00a0MB`
  return `${kilobytes.format(Math.max(1, bytes / 1024))}\u00a0KB`
}

export function DocumentDetailPage() {
  const { documentId } = useParams()
  // The route cannot match without the segment, so this is only for the type.
  return <DetailView key={documentId} documentId={documentId ?? ""} />
}

function DetailView({ documentId }: { documentId: string }) {
  const navigate = useNavigate()
  const [confirmingReprocess, setConfirmingReprocess] = useState<DocumentVersion | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const detail = useDocument(documentId)
  const lookups = useDocumentLookups()
  const promote = usePromoteVersion()
  const reprocess = useReprocessVersion()
  const save = useSaveDocument()
  const remove = useDeleteDocument()
  const setSkill = useSetDocumentSkill()

  const document = detail.data

  async function handleSave(body: Record<string, unknown>) {
    await save.mutateAsync({ id: documentId, body })
    toast.success("Changes saved")
  }

  function handleDelete() {
    remove.mutate(
      { id: documentId },
      {
        onSuccess: () => {
          toast.success(`${document?.title ?? "Document"} deleted`)
          // The page it was showing no longer exists, so stay off it.
          navigate("/admin/documents")
        },
        // A 409 names what still points at this document. That sentence is the
        // whole answer, so it is shown as the server wrote it.
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not delete the document."),
      },
    )
  }

  function runReprocess(version: DocumentVersion) {
    reprocess.mutate(
      { id: documentId, versionNumber: version.version_number },
      {
        onSuccess: () => toast.success(`Version ${version.version_number} queued for reprocessing`),
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not start reprocessing."),
      },
    )
  }

  // Re-running a ready version deletes its chunks and vectors first, so the
  // live document goes dark until it finishes. A failed or queued version has
  // nothing to lose, so it goes straight through.
  function handleReprocess(version: DocumentVersion) {
    if (version.processing_status === "ready") setConfirmingReprocess(version)
    else runReprocess(version)
  }

  function handlePromote(version: DocumentVersion) {
    promote.mutate(
      { id: documentId, versionNumber: version.version_number },
      {
        onSuccess: () => toast.success(`Version ${version.version_number} is now live`),
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not promote the version."),
      },
    )
  }

  function handleSkill(skillId: string, attached: boolean) {
    setSkill.mutate(
      { id: documentId, skillId, attached },
      {
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not change the skill tags."),
      },
    )
  }

  const attachedIds = document?.skill_ids ?? []
  const attachedSkills = attachedIds.map((id) => ({
    id,
    name: lookups.skills.find((skill) => skill.id === id)?.name ?? "Unknown skill",
  }))
  // Only what is not already on the document — re-attaching an existing tag is
  // a no-op on the server, so offering it would be an option that does nothing.
  const availableSkills = lookups.skills.filter((skill) => !attachedIds.includes(skill.id))

  const versions = document?.versions ?? []

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin/documents"
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" />
        Documents
      </Link>

      <PageHeader
        eyebrow="Document"
        title={document?.title ?? "Document"}
        description={
          document?.description !== null && document?.description !== undefined
            ? document.description
            : "Every upload under this title is kept as a version. Promote the one the chatbot should read from."
        }
        actions={
          document === undefined ? undefined : (
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

      {detail.isPending ? (
        // Not role="status": ProcessingBadge below already gives each version
        // row its own live region, and this text is gone before that ever
        // renders — the two would only ever collide, never coexist usefully.
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : detail.isError ? (
        <div className="rounded-xl border border-border bg-card py-10">
          <QueryErrorState
            title="Could not load this document"
            error={detail.error}
            retrying={detail.isFetching}
            onRetry={() => void detail.refetch()}
          />
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="label-micro">Skills</h2>
            <div className="flex flex-wrap items-center gap-2">
              {attachedSkills.length === 0 ? (
                <span className="text-sm text-muted-foreground">
                  Untagged. Tags decide which exams and quizzes can draw on this.
                </span>
              ) : (
                attachedSkills.map((skill) => (
                  <Badge key={skill.id} variant="outline" className="pr-1">
                    {skill.name}
                    <button
                      type="button"
                      disabled={setSkill.isPending}
                      aria-label={`Remove ${skill.name}`}
                      onClick={() => handleSkill(skill.id, false)}
                      className="ml-0.5 rounded-full p-0.5 transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </Badge>
                ))
              )}

              <div className="ml-auto flex flex-col gap-1.5">
                <label htmlFor="add-skill" className="sr-only">
                  Add skill
                </label>
                <select
                  id="add-skill"
                  value=""
                  disabled={setSkill.isPending || availableSkills.length === 0}
                  onChange={(event) => {
                    if (event.target.value !== "") handleSkill(event.target.value, true)
                  }}
                  className="h-8 w-48 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
                >
                  <option value="">
                    {availableSkills.length === 0 ? "All skills added" : "Add skill…"}
                  </option>
                  {availableSkills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-4">
              <h2 className="label-micro">Versions</h2>
              <span className="text-sm text-muted-foreground">
                <span className="numeric text-foreground">{versions.length}</span>{" "}
                {versions.length === 1 ? "version" : "versions"}
              </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-28">
                      <span className="label-micro">Version</span>
                    </TableHead>
                    <TableHead>
                      <span className="label-micro">File</span>
                    </TableHead>
                    <TableHead className="w-24">
                      <span className="label-micro">Size</span>
                    </TableHead>
                    <TableHead className="w-36">
                      <span className="label-micro">Processing</span>
                    </TableHead>
                    <TableHead className="w-48 text-right">
                      <span className="label-micro">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center">
                        <p className="text-sm font-medium text-foreground">No versions yet</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Upload a file under this title to add the first one.
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                  {versions.map((version) => {
                    const isLive = version.version_number === document?.active_version_number
                    const canPromote = version.processing_status === "ready" && !isLive
                    const isProcessing = version.processing_status === "processing"

                    return (
                      <TableRow key={version.version_number}>
                        {/* The brass left edge is the same "this one" marker the
                            sidebar uses for the active nav item. */}
                        <TableCell
                          className={`border-l-2 ${isLive ? "border-ring" : "border-transparent"}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="numeric font-medium">v{version.version_number}</span>
                            {isLive && <span className="label-micro text-ring">Live</span>}
                          </div>
                        </TableCell>
                        <TableCell className="min-w-0 max-w-md">
                          <div className="flex min-w-0 flex-col">
                            <span className="break-words">{version.file_name}</span>
                            {version.change_note !== null && version.change_note !== "" && (
                              <span className="text-xs break-words text-muted-foreground">
                                {version.change_note}
                              </span>
                            )}
                            {version.processing_error !== null && (
                              <span className="text-xs break-words text-destructive">
                                {version.processing_error}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="numeric text-sm text-muted-foreground">
                            {formatSize(version.file_size_bytes)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ProcessingBadge status={version.processing_status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canPromote && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={promote.isPending}
                                onClick={() => handlePromote(version)}
                              >
                                Promote
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isProcessing || reprocess.isPending}
                              onClick={() => handleReprocess(version)}
                            >
                              Reprocess
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}

      {editOpen && document !== undefined && (
        <DocumentEditDialog
          row={{
            title: document.title,
            category_id: document.category_id,
            description: document.description,
          }}
          options={{
            categories: lookups.categories.map((row) => ({ value: row.id, label: row.name })),
          }}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${document?.title} permanently?`}
        description="This removes the document, every version of it, and the stored files and search index behind them. It cannot be undone — re-uploading is the only way back. If an exam, a daily quiz config or a chat answer still refers to it, the delete is refused and nothing changes."
        confirmLabel="Delete permanently"
        confirmVariant="destructive"
        onConfirm={() => {
          setDeleteOpen(false)
          handleDelete()
        }}
      />

      <ConfirmDialog
        open={confirmingReprocess !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingReprocess(null)
        }}
        title={`Reprocess version ${confirmingReprocess?.version_number}?`}
        description="Its existing text and embeddings are deleted before it runs again. If this is the live version, the chatbot has nothing to read from until it finishes."
        confirmLabel="Reprocess"
        onConfirm={() => {
          if (confirmingReprocess !== null) runReprocess(confirmingReprocess)
          setConfirmingReprocess(null)
        }}
      />
    </div>
  )
}
