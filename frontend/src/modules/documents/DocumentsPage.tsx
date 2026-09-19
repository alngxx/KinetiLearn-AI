import {
  CircleCheckIcon,
  CircleSlashIcon,
  GraduationCapIcon,
  PencilIcon,
  TagIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
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
import type { DocumentRow, LookupRow, UploadInput } from "@/modules/documents/api"
import { DocumentEditDialog } from "@/modules/documents/DocumentEditDialog"
import { ManageClassesDialog } from "@/modules/documents/ManageClassesDialog"
import { ManageSkillsDialog } from "@/modules/documents/ManageSkillsDialog"
import { ProcessingBadge } from "@/modules/documents/ProcessingBadge"
import {
  useActiveClasses,
  useDeleteDocument,
  useDocumentLookups,
  useDocuments,
  useSaveDocument,
  useSetDocumentActive,
  useSkillsForCategory,
  useSuggestSkills,
  useUploadDocument,
} from "@/modules/documents/queries"
import { UploadDialog } from "@/modules/documents/UploadDialog"

function nameFor(rows: LookupRow[], id: string | null | undefined) {
  if (id === null || id === undefined) return null
  return rows.find((row) => row.id === id)?.name ?? null
}

type Section = { key: string; name: string; rows: DocumentRow[] }

// Sections are built from the category list rather than from the documents, so
// a category with nothing in it is still knowable — it goes to the strip under
// the sections instead of vanishing. The categories arrive unordered from the
// API, and sorting by name keeps a section where the admin last saw it rather
// than moving it every time something is uploaded.
function groupByCategory(rows: DocumentRow[], categories: LookupRow[]) {
  const known = new Set(categories.map((category) => category.id))
  const byCategory = new Map<string, DocumentRow[]>()
  // A null category, or one that has since been deactivated, would otherwise
  // have no section to land in and would drop off the page silently.
  const uncategorized: DocumentRow[] = []

  for (const row of rows) {
    const id = row.category_id
    if (id === null || !known.has(id)) {
      uncategorized.push(row)
      continue
    }
    const bucket = byCategory.get(id)
    if (bucket === undefined) byCategory.set(id, [row])
    else bucket.push(row)
  }

  const sections: Section[] = []
  const emptyCategories: string[] = []

  for (const category of [...categories].sort((a, b) => a.name.localeCompare(b.name))) {
    const bucket = byCategory.get(category.id)
    if (bucket === undefined) emptyCategories.push(category.name)
    else sections.push({ key: category.id, name: category.name, rows: bucket })
  }

  if (uncategorized.length > 0) {
    sections.push({ key: "uncategorized", name: "Uncategorized", rows: uncategorized })
  }

  return { sections, emptyCategories }
}

const FILTER_KEYS = ["inactive"] as const

export function DocumentsPage() {
  const navigate = useNavigate()
  const { values: filterValues, setFilter } = useUrlFilters(FILTER_KEYS)
  const includeInactive = filterValues.inactive === "1"
  const [uploadOpen, setUploadOpen] = useState(false)
  const [confirming, setConfirming] = useState<DocumentRow | null>(null)
  const [editing, setEditing] = useState<DocumentRow | null>(null)
  const [deleting, setDeleting] = useState<DocumentRow | null>(null)
  const [managing, setManaging] = useState<DocumentRow | null>(null)
  const [managingSkills, setManagingSkills] = useState<DocumentRow | null>(null)

  // One request for the whole library: the category sections below are the
  // filter now, so there is nothing left to narrow server-side.
  const filters = includeInactive ? { include_inactive: true } : {}

  const lookups = useDocumentLookups()
  const classes = useActiveClasses()
  // Scoped to whichever document's dialog is open: skills only exist inside a
  // category, so there is no one list to fetch up front.
  const skillsForCategory = useSkillsForCategory(managingSkills?.category_id ?? null)
  const suggest = useSuggestSkills()
  const list = useDocuments(filters)
  const upload = useUploadDocument()
  const setActive = useSetDocumentActive()
  const save = useSaveDocument()
  const remove = useDeleteDocument()

  const options: Record<string, Option[]> = {
    categories: lookups.categories.map((row) => ({ value: row.id, label: row.name })),
  }

  const classRows = classes.data ?? []
  const classOptions: Option[] = classRows.map((row) => ({ value: row.id, label: row.name }))

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

  async function handleSaveClasses(row: DocumentRow, classIds: string[]) {
    await save.mutateAsync({ id: row.document_id, body: { class_ids: classIds } })
    toast.success(`Classes updated for ${row.title}`)
  }

  async function handleSaveSkills(row: DocumentRow, skillIds: string[]) {
    await save.mutateAsync({ id: row.document_id, body: { skill_ids: skillIds } })
    toast.success(`Skills updated for ${row.title}`)
  }

  // Hands the suggestion back to the dialog rather than applying it here — the
  // admin confirms before anything is written.
  async function handleSuggestSkills(row: DocumentRow): Promise<string[]> {
    const result = await suggest.mutateAsync({ id: row.document_id })
    return result.skill_ids
  }

  function handleDelete(row: DocumentRow) {
    remove.mutate(
      { id: row.document_id },
      {
        onSuccess: () => toast.success(`${row.title} deleted`),
        // A 409 names what still points at this document — an exam or a daily
        // quiz config. That sentence is the whole answer, so it is shown as
        // the server wrote it.
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
  const { sections, emptyCategories } = groupByCategory(rows, lookups.categories)

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
          {rows.length === 1 ? "document" : "documents"}
        </span>
      </div>

      {list.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : list.isError ? (
        <div className="surface py-10">
          <QueryErrorState
            title="Could not load documents"
            error={list.error}
            retrying={list.isFetching}
            onRetry={() => void list.refetch()}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="surface py-12 text-center">
          <p className="text-sm font-medium text-foreground">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a PDF, DOCX, or Markdown file to give the chatbot something to read.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-6">
            {sections.map((section, index) => (
              <CategorySection
                key={section.key}
                section={section}
                index={index}
                skills={lookups.skills}
                classes={classRows}
                onEdit={setEditing}
                onManageClasses={setManaging}
                onManageSkills={setManagingSkills}
                onToggleActive={(row) =>
                  row.is_active ? setConfirming(row) : handleSetActive(row, true)
                }
                onDelete={setDeleting}
                activePending={setActive.isPending}
                deletePending={remove.isPending}
              />
            ))}
          </div>

          {/* The categories nobody has filed anything under yet. A section each
              would be five empty states to say what one line says here, and
              dropping them entirely would hide that they exist at all. */}
          {emptyCategories.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span id="empty-categories" className="label-micro">
                Nothing uploaded yet
              </span>
              {/* A real list, so it is announced as one rather than as a run-on
                  of category names after the label. */}
              <ul aria-labelledby="empty-categories" className="flex flex-wrap items-center gap-2">
                {emptyCategories.map((name) => (
                  <li key={name}>
                    <Badge variant="outline">{name}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {uploadOpen && (
        <UploadDialog
          options={options}
          classes={classOptions}
          classesLoading={classes.isPending}
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

      {managing !== null && (
        <ManageClassesDialog
          key={managing.document_id}
          title={managing.title}
          classes={classOptions}
          classesLoading={classes.isPending}
          initialClassIds={managing.class_ids}
          open={true}
          onOpenChange={(open) => {
            if (!open) setManaging(null)
          }}
          onSave={(classIds) => handleSaveClasses(managing, classIds)}
        />
      )}

      {managingSkills !== null && (
        <ManageSkillsDialog
          key={managingSkills.document_id}
          title={managingSkills.title}
          categoryId={managingSkills.category_id}
          skills={(skillsForCategory.data ?? []).map((row) => ({
            value: row.id,
            label: row.name,
          }))}
          skillsLoading={skillsForCategory.isPending}
          initialSkillIds={managingSkills.skill_ids}
          open={true}
          suggesting={suggest.isPending}
          onOpenChange={(open) => {
            if (!open) setManagingSkills(null)
          }}
          onSuggest={() => handleSuggestSkills(managingSkills)}
          onSave={(skillIds) => handleSaveSkills(managingSkills, skillIds)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete ${deleting?.title} permanently?`}
        description="This removes the document, every version of it, and the stored files and search index behind them. It cannot be undone — re-uploading is the only way back. If an exam or a daily quiz config still refers to it, the delete is refused and nothing changes. Chat answers that cited it keep their text but lose their source link."
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

function CategorySection({
  section,
  index,
  skills,
  classes,
  onEdit,
  onManageClasses,
  onManageSkills,
  onToggleActive,
  onDelete,
  activePending,
  deletePending,
}: {
  section: Section
  index: number
  skills: LookupRow[]
  classes: LookupRow[]
  onEdit: (row: DocumentRow) => void
  onManageClasses: (row: DocumentRow) => void
  onManageSkills: (row: DocumentRow) => void
  onToggleActive: (row: DocumentRow) => void
  onDelete: (row: DocumentRow) => void
  activePending: boolean
  deletePending: boolean
}) {
  const headingId = `documents-${section.key}`

  return (
    // The stagger sits on the section rather than the row: per-section indices
    // would restart at zero in every table and step them all in unison anyway.
    <div style={staggerStyle(index, { step: "40ms" })} className="enter-stagger flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id={headingId} className="label-micro">
          {section.name}
        </h2>
        {/* A count to scan against the table beside it. Read aloud, a bare
            number after the heading only asks "three what?" — the table below
            already announces its own size. */}
        <span aria-hidden="true" className="numeric text-xs text-muted-foreground">
          {section.rows.length}
        </span>
      </div>

      <div className="overflow-hidden surface">
        {/* Named by its own heading, so the tables stay tellable apart when a
            screen reader lists them. */}
        <Table aria-labelledby={headingId}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <span className="label-micro">Title</span>
              </TableHead>
              <TableHead>
                <span className="label-micro">Skills</span>
              </TableHead>
              <TableHead>
                <span className="label-micro">Classes</span>
              </TableHead>
              <TableHead className="w-36">
                <span className="label-micro">Processing</span>
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
            {section.rows.map((row) => (
              <DocumentTableRow
                key={row.document_id}
                row={row}
                skills={skills}
                classes={classes}
                onEdit={onEdit}
                onManageClasses={onManageClasses}
                onManageSkills={onManageSkills}
                onToggleActive={onToggleActive}
                onDelete={onDelete}
                activePending={activePending}
                deletePending={deletePending}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function DocumentTableRow({
  row,
  skills,
  classes,
  onEdit,
  onManageClasses,
  onManageSkills,
  onToggleActive,
  onDelete,
  activePending,
  deletePending,
}: {
  row: DocumentRow
  skills: LookupRow[]
  classes: LookupRow[]
  onEdit: (row: DocumentRow) => void
  onManageClasses: (row: DocumentRow) => void
  onManageSkills: (row: DocumentRow) => void
  onToggleActive: (row: DocumentRow) => void
  onDelete: (row: DocumentRow) => void
  activePending: boolean
  deletePending: boolean
}) {
  const names = row.skill_ids
    .map((id) => nameFor(skills, id))
    .filter((name): name is string => name !== null)
  const classNames = row.class_ids
    .map((id) => nameFor(classes, id))
    .filter((name): name is string => name !== null)

  return (
    <TableRow className={row.is_active ? "" : "opacity-60"}>
      <TableCell>
        <Link
          to={`/admin/documents/${row.document_id}`}
          className="font-medium underline-offset-4 transition-colors outline-none hover:text-ring hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/75"
        >
          {row.title}
        </Link>
      </TableCell>
      <TableCell>
        {names.length === 0 ? (
          <span className="text-muted-foreground">Untagged</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {names.map((skill) => (
              <Badge key={skill} variant="outline">
                {skill}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        {classNames.length === 0 ? (
          // Not decoration: an unassigned document is invisible in every
          // exam-generation picker, so this is the state that needs naming.
          <span className="text-muted-foreground">Unassigned</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {classNames.map((name) => (
              <Badge key={name} variant="outline">
                {name}
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
        <RowActions
          label={row.title}
          inlineAction={{ label: "Edit", icon: PencilIcon, onSelect: () => onEdit(row) }}
          actions={[
            {
              label: "Manage skills",
              icon: TagIcon,
              onSelect: () => onManageSkills(row),
            },
            {
              label: "Manage classes",
              icon: GraduationCapIcon,
              onSelect: () => onManageClasses(row),
            },
            {
              label: row.is_active ? "Deactivate" : "Activate",
              icon: row.is_active ? CircleSlashIcon : CircleCheckIcon,
              disabled: activePending,
              onSelect: () => onToggleActive(row),
            },
            {
              label: "Delete",
              icon: Trash2Icon,
              destructive: true,
              disabled: deletePending,
              onSelect: () => onDelete(row),
            },
          ]}
        />
      </TableCell>
    </TableRow>
  )
}
