import { UploadIcon } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
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
import type { DocumentRow, LookupRow, UploadInput } from "@/modules/documents/api"
import { DocumentEditDialog } from "@/modules/documents/DocumentEditDialog"
import { ProcessingBadge } from "@/modules/documents/ProcessingBadge"
import {
  useDeleteDocument,
  useDocumentLookups,
  useDocuments,
  useSaveDocument,
  useSetDocumentActive,
  useUploadDocument,
} from "@/modules/documents/queries"
import { UploadDialog } from "@/modules/documents/UploadDialog"

function nameFor(rows: LookupRow[], id: string | null | undefined) {
  if (id === null || id === undefined) return null
  return rows.find((row) => row.id === id)?.name ?? null
}

export function DocumentsPage() {
  const navigate = useNavigate()
  const [categoryId, setCategoryId] = useState("")
  const [includeInactive, setIncludeInactive] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [confirming, setConfirming] = useState<DocumentRow | null>(null)
  const [editing, setEditing] = useState<DocumentRow | null>(null)
  const [deleting, setDeleting] = useState<DocumentRow | null>(null)

  const filters = {
    ...(categoryId === "" ? {} : { category_id: categoryId }),
    ...(includeInactive ? { include_inactive: true } : {}),
  }

  const lookups = useDocumentLookups()
  const list = useDocuments(filters)
  const upload = useUploadDocument()
  const setActive = useSetDocumentActive()
  const save = useSaveDocument()
  const remove = useDeleteDocument()

  const options: Record<string, Option[]> = {
    categories: lookups.categories.map((row) => ({ value: row.id, label: row.name })),
  }

  async function handleUpload(input: UploadInput) {
    const result = await upload.mutateAsync(input)
    toast.success(`Uploaded as version ${result.version_number}`)
    // The list column tracks the active version, so a new version of an
    // already-live document would not show its progress here. The detail view
    // polls every version, so that is where the upload lands.
    navigate(`/admin/documents/${result.document_id}`)
  }

  async function handleSave(id: string, body: Record<string, unknown>) {
    await save.mutateAsync({ id, body })
    toast.success("Changes saved")
  }

  function handleDelete(row: DocumentRow) {
    remove.mutate(
      { id: row.document_id },
      {
        onSuccess: () => toast.success(`${row.title} deleted`),
        // A 409 names what still points at this document — an exam, a daily
        // quiz config, or a chat answer that cited it. That sentence is the
        // whole answer, so it is shown as the server wrote it.
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not delete the document."),
      },
    )
  }

  function handleSetActive(row: DocumentRow, active: boolean) {
    setActive.mutate(
      { id: row.document_id, active },
      {
        onSuccess: () =>
          toast.success(active ? `${row.title} activated` : `${row.title} deactivated`),
        onError: (err) =>
          toast.error(isApiError(err) ? err.message : "Could not change the status."),
      },
    )
  }

  const rows = list.data ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Content"
        title="Documents"
        description="The source material that RAG chatbot, exams and daily quizzes read from" 
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <UploadIcon />
            Upload document
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="category-filter" className="label-micro">
            Category
          </label>
          <select
            id="category-filter"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
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
          {rows.length === 1 ? "document" : "documents"}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <span className="label-micro">Title</span>
              </TableHead>
              <TableHead>
                <span className="label-micro">Category</span>
              </TableHead>
              <TableHead>
                <span className="label-micro">Skills</span>
              </TableHead>
              <TableHead className="w-36">
                <span className="label-micro">Processing</span>
              </TableHead>
              <TableHead className="w-28">
                <span className="label-micro">Status</span>
              </TableHead>
              <TableHead className="w-56 text-right">
                <span className="label-micro">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isPending ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : list.isError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-10 text-center">
                  <QueryErrorState
                    title="Could not load documents"
                    error={list.error}
                    retrying={list.isFetching}
                    onRetry={() => void list.refetch()}
                  />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center">
                  <p className="text-sm font-medium text-foreground">Nothing here yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Upload a PDF or DOCX to give the chatbot something to read.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const skills = row.skill_ids
                  .map((id) => nameFor(lookups.skills, id))
                  .filter((name): name is string => name !== null)

                return (
                  <TableRow
                    key={row.document_id}
                    className={row.is_active ? "" : "opacity-60"}
                  >
                    <TableCell>
                      <Link
                        to={`/admin/documents/${row.document_id}`}
                        className="font-medium underline-offset-4 transition-colors outline-none hover:text-ring hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {row.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {nameFor(lookups.categories, row.category_id) ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {skills.length === 0 ? (
                        <span className="text-muted-foreground">Untagged</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {skills.map((skill) => (
                            <Badge key={skill} variant="outline">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProcessingBadge status={row.active_version_processing_status} />
                        {row.active_version_number !== null && (
                          <span className="numeric text-xs text-muted-foreground">
                            v{row.active_version_number}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge active={row.is_active} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
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
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {uploadOpen && (
        <UploadDialog
          options={options}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onUpload={handleUpload}
        />
      )}

      {editing !== null && (
        <DocumentEditDialog
          key={editing.document_id}
          row={{ title: editing.title, category_id: editing.category_id }}
          options={options}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onSave={(body) => handleSave(editing.document_id, body)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete ${deleting?.title} permanently?`}
        description="This removes the document, every version of it, and the stored files and search index behind them. It cannot be undone — re-uploading is the only way back. If an exam, a daily quiz config or a chat answer still refers to it, the delete is refused and nothing changes."
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
        title={`Deactivate ${confirming?.title}?`}
        description="The chatbot, exams and daily quizzes stop drawing on it, and it disappears from this list unless you show inactive documents. You can activate it again later."
        confirmLabel="Deactivate"
        onConfirm={() => {
          if (confirming !== null) handleSetActive(confirming, false)
          setConfirming(null)
        }}
      />
    </div>
  )
}
