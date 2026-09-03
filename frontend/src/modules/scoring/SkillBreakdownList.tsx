import { Badge } from "@/components/ui/badge"
import { staggerStyle } from "@/lib/stagger"
import type { SkillBreakdownItem } from "@/modules/scoring/api"
import { SkillBandBar } from "@/modules/scoring/SkillBandBar"

const updatedFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
})

const LEVEL_LABEL: Record<string, string> = {
  basic: "Basic",
  intermediate: "Intermediate",
  advanced: "Advanced",
}

// Matches SkillBandBar's hues: info blue for basic, then outline, then success
// at mastery — so a level's badge colour means the same thing as the bar
// segment beside it, rather than info doubling as "basic" in one and
// "intermediate" in the other.
const LEVEL_VARIANT: Record<string, "outline" | "info" | "success"> = {
  basic: "info",
  intermediate: "outline",
  advanced: "success",
}

// Preserves the order the API already returns (by skill name within each
// category) rather than re-sorting, and groups by first appearance so
// categories don't jump around between renders.
function groupByCategory(items: SkillBreakdownItem[]): { category: string; items: SkillBreakdownItem[] }[] {
  const groups: { category: string; items: SkillBreakdownItem[] }[] = []
  const byCategory = new Map<string, SkillBreakdownItem[]>()

  for (const item of items) {
    let bucket = byCategory.get(item.category_name)
    if (bucket === undefined) {
      bucket = []
      byCategory.set(item.category_name, bucket)
      groups.push({ category: item.category_name, items: bucket })
    }
    bucket.push(item)
  }

  return groups
}

function updatedLine(item: SkillBreakdownItem) {
  return item.last_updated_at === null
    ? "Not yet scored"
    : `Updated ${updatedFormat.format(new Date(item.last_updated_at))}`
}

// The bar and its numbers mean nothing read aloud, so this carries it
// instead — same approach ThresholdLadder uses.
function srSentence(item: SkillBreakdownItem, label: string) {
  return `${item.cumulative_score} points, ${label.toLowerCase()}. Basic up to ${item.basic_max}, intermediate up to ${item.intermediate_max}, advanced above ${item.intermediate_max}.`
}

// The admin's view of one learner's skills: every band and both cut points
// spelled out, because this is the screen a training manager reasons about
// thresholds on. The learner's own screen draws the same data its own way.
export function SkillBreakdownList({ items }: { items: SkillBreakdownItem[] }) {
  return (
    <div className="flex flex-col gap-6">
      {groupByCategory(items).map((group, index) => (
        <div
          key={group.category}
          style={staggerStyle(index, { step: "40ms" })}
          className="enter-stagger flex flex-col gap-3"
        >
          <h2 className="label-micro">{group.category}</h2>
          <div className="overflow-hidden surface">
            <ul className="divide-y divide-border">
              {group.items.map((item) => (
                <ListRow key={item.skill_id} item={item} />
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  )
}

function ListRow({ item }: { item: SkillBreakdownItem }) {
  const label = LEVEL_LABEL[item.current_level] ?? item.current_level
  const variant = LEVEL_VARIANT[item.current_level] ?? "outline"

  return (
    <li className="flex flex-wrap items-center gap-4 p-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium break-words text-foreground">{item.skill_name}</span>
        <span className="text-xs text-muted-foreground">{updatedLine(item)}</span>
      </div>

      <SkillBandBar
        score={item.cumulative_score}
        basicMax={item.basic_max}
        intermediateMax={item.intermediate_max}
      />
      <span className="sr-only">{srSentence(item, label)}</span>

      <span className="numeric w-14 shrink-0 text-right text-sm text-foreground">
        {item.cumulative_score}
      </span>

      <Badge variant={variant} className="shrink-0">
        {label}
      </Badge>
    </li>
  )
}
