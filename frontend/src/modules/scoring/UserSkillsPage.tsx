import { ChevronLeftIcon } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { PageHeader } from "@/components/PageHeader"
import { QueryErrorState } from "@/components/QueryErrorState"
import { useSkillBreakdown, useUser } from "@/modules/scoring/queries"
import { SkillBreakdownList } from "@/modules/scoring/SkillBreakdownList"

export function UserSkillsPage() {
  const { userId } = useParams()
  // The route cannot match without the segment, so this is only for the type.
  return <PageView key={userId} userId={userId ?? ""} />
}

function PageView({ userId }: { userId: string }) {
  const user = useUser(userId)
  const breakdown = useSkillBreakdown(userId)

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/admin/users"
        className="-mb-2 flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/75"
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
        <p role="status" className="py-10 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : breakdown.isError ? (
        <div className="surface py-10">
          <QueryErrorState
            title="Could not load this learner's skills"
            error={breakdown.error}
            retrying={breakdown.isFetching}
            onRetry={() => void breakdown.refetch()}
          />
        </div>
      ) : breakdown.data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          There are no active skills to score against.
        </p>
      ) : (
        // A deliberate preservation of current behaviour, not an oversight —
        // the admin per-learner view keeps the row list.
        <SkillBreakdownList items={breakdown.data} layout="list" />
      )}
    </div>
  )
}
