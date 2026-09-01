import { CircleDashedIcon } from "lucide-react"
import { EmptyState } from "@/components/EmptyState"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import type { SkillBreakdownItem } from "@/modules/scoring/api"
import { useMySkillBreakdown } from "@/modules/scoring/queries"
import { hasAnyScore, MIN_RADAR_AXES, toRadarPoints } from "@/modules/scoring/skillRadar"
import { SkillBreakdownList } from "@/modules/scoring/SkillBreakdownList"
import { SkillRadarChart } from "@/modules/scoring/SkillRadarChart"

export function SkillDashboardPage() {
  const breakdown = useMySkillBreakdown()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Skills"
        title="Your skills"
        description="How you are doing across every skill your training covers. Points come from daily quizzes and exercises."
      />

      {breakdown.isPending ? (
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : breakdown.isError ? (
        <div className="surface py-10">
          <QueryErrorState
            title="Could not load your skills"
            error={breakdown.error}
            retrying={breakdown.isFetching}
            onRetry={() => void breakdown.refetch()}
          />
        </div>
      ) : breakdown.data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No skills have been set up for your training yet.
        </p>
      ) : (
        <>
          <Overview items={breakdown.data} />
          <SkillBreakdownList items={breakdown.data} layout="grid" />
        </>
      )}
    </div>
  )
}

// A radar with nothing in it collapses to a dot at the centre, which reads as
// broken rather than as "nothing scored yet" — the same call the class cards
// make when there is no denominator to draw a progress bar against. The list
// below still shows every skill at zero, so the learner can see what they will
// be measured on.
function Overview({ items }: { items: SkillBreakdownItem[] }) {
  if (!hasAnyScore(items)) {
    return (
      <EmptyState
        icon={CircleDashedIcon}
        title="Nothing scored yet"
        body="Finish a daily quiz or an exercise and your scores start filling in here."
      />
    )
  }

  // Under three axes there is no polygon, only a line. There are real scores
  // here, so nothing is missing — the list below already says all of it.
  if (items.length < MIN_RADAR_AXES) return null

  return (
    <div className="flex flex-col gap-3 surface p-5">
      <SkillRadarChart points={toRadarPoints(items)} />
      {/* The rings are the only part of the chart carrying the thresholds, and
          an unlabelled ring means nothing on its own. "Cut point" and "ceiling"
          are the admin console's words for these, not a learner's. */}
      <p className="text-center text-xs text-pretty text-muted-foreground">
        Every skill is drawn on its own scale. The two inner rings are where you move
        up to intermediate and to advanced.
      </p>
    </div>
  )
}
