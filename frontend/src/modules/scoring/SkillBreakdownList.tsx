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

// The same rows for both readers of this data: the admin looking at one
// learner, and the learner looking at themselves. It is also the accessible
// form of the radar chart on the learner page, which is why it carries the
// exact numbers rather than only the bars.
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
              {group.items.map((item) => {
                const level = LEVEL_LABEL[item.current_level] ?? item.current_level
                const variant = LEVEL_VARIANT[item.current_level] ?? "outline"
                return (
                  <li
                    key={item.skill_id}
                    className="flex flex-wrap items-center gap-4 p-3.5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium break-words text-foreground">
                        {item.skill_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.last_updated_at === null
                          ? "Not yet scored"
                          : `Updated ${updatedFormat.format(new Date(item.last_updated_at))}`}
                      </span>
                    </div>

                    <SkillBandBar
                      score={item.cumulative_score}
                      basicMax={item.basic_max}
                      intermediateMax={item.intermediate_max}
                    />
                    {/* The bar and its numbers mean nothing read aloud, so this
                        carries it instead — same approach ThresholdLadder uses. */}
                    <span className="sr-only">
                      {`${item.cumulative_score} points, ${level.toLowerCase()}. Basic up to ${item.basic_max}, intermediate up to ${item.intermediate_max}, advanced above ${item.intermediate_max}.`}
                    </span>

                    <span className="numeric w-14 shrink-0 text-right text-sm text-foreground">
                      {item.cumulative_score}
                    </span>

                    <Badge variant={variant} className="shrink-0">
                      {level}
                    </Badge>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      ))}
    </div>
  )
}
