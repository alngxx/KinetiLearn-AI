import { SparklesIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { CheckboxGroup } from "@/components/form/CheckboxGroup"
import type { Option } from "@/components/form/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isApiError } from "@/lib/errors"

// Skill tags are what make an exam score anything: a correct answer credits the
// skills its source document carries, so an untagged document produces an exam
// that awards nothing. Kept as its own action rather than a field on the edit
// form because the AI suggestion needs somewhere to live and because skills are
// scoped to the document's category, which the edit form can change.
export function ManageSkillsDialog({
  title,
  categoryId,
  skills,
  skillsLoading,
  initialSkillIds,
  open,
  suggesting,
  onOpenChange,
  onSuggest,
  onSave,
}: {
  title: string
  categoryId: string | null
  skills: Option[]
  skillsLoading: boolean
  initialSkillIds: string[]
  open: boolean
  suggesting: boolean
  onOpenChange: (open: boolean) => void
  onSuggest: () => Promise<string[]>
  onSave: (skillIds: string[]) => Promise<void>
}) {
  const [skillIds, setSkillIds] = useState<string[]>(initialSkillIds)
  const [error, setError] = useState<string | undefined>(undefined)
  const [suggestError, setSuggestError] = useState<string | undefined>(undefined)
  const [suggestNote, setSuggestNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [focusGroup, setFocusGroup] = useState(false)

  // Skills only exist inside a category, so an uncategorized document has no
  // valid list to pick from — the server refuses it too.
  const noCategory = categoryId === null

  // Focus moves from an effect rather than inside the handler, for the same
  // reason useEntityForm does it: the error the group's aria-describedby points
  // at is only in the DOM once this render has committed.
  useEffect(() => {
    if (!focusGroup) return
    document.getElementById("skills")?.focus()
    setFocusGroup(false)
  }, [focusGroup])

  async function handleSuggest() {
    setSuggestError(undefined)
    setSuggestNote("")
    try {
      const suggested = await onSuggest()
      // Replaces the selection rather than adding to it — the point is to see
      // what the model thinks, then correct it. Nothing is saved either way.
      setSkillIds(suggested)
      setError(undefined)
      setSuggestNote(
        suggested.length === 0
          ? "No skills matched this document. Choose any that apply, or leave it untagged."
          : `Selected ${suggested.length} suggested ${suggested.length === 1 ? "skill" : "skills"}. Review them, then save.`,
      )
    } catch (err) {
      // The picker is left exactly as the admin had it, and the button returns
      // to idle so this can be retried.
      setSuggestError(
        isApiError(err) ? err.message : "Could not reach the suggestion service. Try again.",
      )
    }
  }

  async function handleSubmit() {
    if (noCategory) return
    setSaving(true)
    try {
      await onSave(skillIds)
      onOpenChange(false)
    } catch (err) {
      setError(isApiError(err) ? err.message : "Could not save the skills.")
      setFocusGroup(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage skills for {title}</DialogTitle>
          <DialogDescription>
            Exam answers credit the skills their source document carries. An untagged
            document scores nothing.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto py-1"
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          {noCategory ? (
            <p className="rounded-lg border border-input p-3 text-sm text-muted-foreground">
              Skills belong to a category, and this document has none. Set its category
              with Edit, then come back here.
            </p>
          ) : (
            <>
              <CheckboxGroup
                id="skills"
                legend="Skills"
                options={skills}
                selected={skillIds}
                error={error}
                loading={skillsLoading}
                emptyText="This category has no skills yet. Add one in Config first."
                onToggle={(value) => {
                  setError(undefined)
                  setSuggestNote("")
                  setSkillIds((current) =>
                    current.includes(value)
                      ? current.filter((id) => id !== value)
                      : [...current, value],
                  )
                }}
              />

              <div className="flex flex-col gap-1.5">
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-busy={suggesting}
                    disabled={suggesting || skillsLoading || skills.length === 0}
                    onClick={() => void handleSuggest()}
                  >
                    <SparklesIcon
                      aria-hidden="true"
                      className={suggesting ? "motion-safe:animate-spin" : undefined}
                    />
                    {suggesting ? "Suggesting…" : "Suggest with AI"}
                  </Button>
                </div>

                {/* Announced rather than just shown: the checkboxes change
                    underneath, which a screen reader would otherwise miss. */}
                <p aria-live="polite" className="text-xs text-muted-foreground">
                  {suggestNote}
                </p>

                {suggestError !== undefined && (
                  <p role="alert" className="text-xs text-destructive">
                    {suggestError}
                  </p>
                )}
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              aria-busy={saving}
              disabled={saving || noCategory}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
