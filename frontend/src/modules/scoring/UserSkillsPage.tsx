import { ChevronLeftIcon } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { Badge } from "@/components/ui/badge"
import type { SkillBreakdownItem } from "@/modules/scoring/api"
import { SkillBandBar } from "@/modules/scoring/SkillBandBar"
import { useSkillBreakdown, useUser } from "@/modules/scoring/queries"

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

const LEVEL_VARIANT: Record<string, "outline" | "info" | "success"> = {
  basic: "outline",
  intermediate: "info",
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

export function UserSkillsPage() {
  const { userId } = useParams()
  // The route cannot match without the segment, so this is only for the type.
  return <PageView key={userId} userId={userId ?? ""} />
}

function PageView({ userId }: { userId: string }) {
  const user = useUser(userId)
  const breakdown = useSkillBreakdown(userId)

  const groups = groupByCategory(breakdown.data ?? [])

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin/users"
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeftIcon className="size-4" />
        Back to users
      </Link>

      <PageHeader
        eyebrow="Skills"
        title={user.data?.full_name ?? "Learner"}
        description="Cumulative score against each active skill's own basic and intermediate cut points. A skill with no submissions yet still shows, at zero."
      />

      {breakdown.isPending ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : breakdown.isError ? (
        <QueryErrorState
          title="Could not load this learner's skills"
          error={breakdown.error}
          retrying={breakdown.isFetching}
          onRetry={() => void breakdown.refetch()}
        />
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          There are no active skills to score against.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.category} className="flex flex-col gap-3">
              <h2 className="label-micro">{group.category}</h2>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
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
                          <span className="text-sm font-medium text-foreground">
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
      )}
    </div>
  )
}
