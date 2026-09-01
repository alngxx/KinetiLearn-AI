import { GaugeIcon } from "lucide-react"
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

// The same data for both readers: the admin looking at one learner, and the
// learner looking at themselves. It is also the accessible form of the radar
// chart on the learner page, which is why it carries the exact numbers rather
// than only the bars. `layout` picks the presentation per caller — the admin
// view keeps the original row list, the learner dashboard gets cards — while
// both stay one <ul> of <li>s underneath, so a category still reads as one
// list to assistive tech and to a test asking for the closest "li".
export function SkillBreakdownList({
  items,
  layout,
}: {
  items: SkillBreakdownItem[]
  layout: "grid" | "list"
}) {
  return (
    <div className="flex flex-col gap-6">
      {groupByCategory(items).map((group, index) => (
        <div
          key={group.category}
          style={staggerStyle(index, { step: "40ms" })}
          className="enter-stagger flex flex-col gap-3"
        >
          <h2 className="label-micro">{group.category}</h2>
          {layout === "grid" ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => (
                <GridCard key={item.skill_id} item={item} />
              ))}
            </ul>
          ) : (
            <div className="overflow-hidden surface">
              <ul className="divide-y divide-border">
                {group.items.map((item) => (
                  <ListRow key={item.skill_id} item={item} />
                ))}
              </ul>
            </div>
          )}
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

// Cards rather than rows for a scannable grid. tabIndex on an otherwise
// static card is deliberate: nothing inside is independently focusable, so
// without it a keyboard user would have no way to land on a card at all and
// get the same highlight a mouse gets on hover.
function GridCard({ item }: { item: SkillBreakdownItem }) {
  const label = LEVEL_LABEL[item.current_level] ?? item.current_level
  const variant = LEVEL_VARIANT[item.current_level] ?? "outline"

  return (
    <li
      tabIndex={0}
      className="surface flex flex-col gap-3 p-4 outline-none transition-colors hover:border-ring/40 hover:bg-accent/40 focus-visible:border-ring/40 focus-visible:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/75"
    >
      <div className="flex items-start justify-between gap-2">
        <GaugeIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        <Badge variant={variant} className="shrink-0">
          {label}
        </Badge>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium break-words text-foreground">{item.skill_name}</span>
        <span className="text-xs text-muted-foreground">{updatedLine(item)}</span>
      </div>

      <SkillBandBar
        score={item.cumulative_score}
        basicMax={item.basic_max}
        intermediateMax={item.intermediate_max}
      />
      <span className="sr-only">{srSentence(item, label)}</span>

      <span className="numeric text-sm text-foreground">{item.cumulative_score}</span>
    </li>
  )
}
