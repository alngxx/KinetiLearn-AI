import { CircleDashedIcon } from "lucide-react"
import { EmptyState } from "@/components/EmptyState"
import { PortalHero } from "@/components/PortalHero"
import { QueryErrorState } from "@/components/QueryErrorState"
import { SectionLabel } from "@/components/SectionLabel"
import { Badge } from "@/components/ui/badge"
import { staggerStyle } from "@/lib/stagger"
import type { SkillBreakdownItem } from "@/modules/scoring/api"
import { useMySkillBreakdown } from "@/modules/scoring/queries"

const scoredFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" })

// One band, one colour, everywhere it appears on this page: the legend dot, the
// badge, and the bar fill all read the same token. Advanced is brass, not green
// — green means "done" elsewhere in the app, and a top band is a standing state
// rather than a completed one.
const BANDS = ["basic", "intermediate", "advanced"] as const
type Band = (typeof BANDS)[number]

const BAND_LABEL: Record<Band, string> = {
  basic: "Basic",
  intermediate: "Intermediate",
  advanced: "Advanced",
}

// Read through style rather than a bg-band-* utility on purpose: only some of
// these compile to utilities, and driving all three the same way keeps the
// legend, the badge and the fill provably the same colour.
const BAND_COLOR: Record<Band, string> = {
  basic: "var(--info)",
  intermediate: "var(--band-intermediate)",
  advanced: "var(--band-advanced)",
}

// The band tokens are tuned as fills, and the mock paints its badge label in
// them directly — which lands the brass and violet under 4.5:1 on a light card.
// Pulling each one towards the page's own text colour fixes that in both
// themes at once: it darkens in light, lightens in dark, and the hue survives.
// Borders, dots and bar fills keep the pure token; only type is adjusted.
function bandInk(color: string) {
  return `color-mix(in oklab, ${color} 68%, var(--foreground))`
}

function bandOf(item: SkillBreakdownItem): Band {
  return (BANDS as readonly string[]).includes(item.current_level)
    ? (item.current_level as Band)
    : "basic"
}

// The mock draws a fixed 0–100 track with its ticks at 50% and 80%, which is
// exactly where its own 49/79 cut points land. Real skills each carry their
// own, so the scale is derived instead: the intermediate ceiling is pinned to
// 80% of the track and advanced — which has no upper bound — gets the last
// fifth. The ticks end up where the mock put them whatever the thresholds are.
const ADVANCED_SHARE = 0.2

function trackPercent(value: number, intermediateMax: number) {
  const scale = intermediateMax > 0 ? intermediateMax / (1 - ADVANCED_SHARE) : 1
  return Math.min(100, Math.max(0, (value / scale) * 100))
}

function metaLine(item: SkillBreakdownItem) {
  return item.last_updated_at === null
    ? "Not yet scored"
    : `Last scored ${scoredFormat.format(new Date(item.last_updated_at))}`
}

// The bar and the bare number mean nothing read aloud, so this carries the
// whole state — the same job SkillBandBar's sr-only sentence does on the admin
// side.
function srSentence(item: SkillBreakdownItem, band: Band) {
  return `${item.cumulative_score} points, ${BAND_LABEL[band].toLowerCase()}. Basic up to ${item.basic_max}, intermediate up to ${item.intermediate_max}, advanced above ${item.intermediate_max}.`
}

// Preserves the order the API returns (skills sorted within each category) and
// groups by first appearance, so categories don't reshuffle between renders.
function groupByCategory(items: SkillBreakdownItem[]) {
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

// The mock's legend prints the numbers (0–49 / 50–79 / 80+) because its skills
// all share one set of cut points. Ours are per-skill, so the ranges are shown
// only when every skill actually agrees on them — otherwise the legend would be
// stating a threshold that is wrong for half the cards under it.
function legendRanges(items: SkillBreakdownItem[]): Record<Band, string> | null {
  const [first] = items
  if (first === undefined) return null

  const uniform = items.every(
    (item) =>
      item.basic_max === first.basic_max && item.intermediate_max === first.intermediate_max,
  )
  if (!uniform) return null

  return {
    basic: `0–${first.basic_max}`,
    intermediate: `${first.basic_max + 1}–${first.intermediate_max}`,
    advanced: `${first.intermediate_max + 1}+`,
  }
}

export function LearnerSkillsPage() {
  const breakdown = useMySkillBreakdown()

  return (
    <div className="flex flex-col">
      <PortalHero
        eyebrow="Skills"
        title="Your skills"
        description="How you are doing across every skill your training covers. Points come from daily quizzes and exercises."
      />

      {/* The same lead Home uses, so both learner screens close their hero on
          the one horizon rule. */}
      <div className="flex flex-col gap-[34px] pt-[34px]">
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
          <Breakdown items={breakdown.data} />
        )}
      </div>
    </div>
  )
}

function Breakdown({ items }: { items: SkillBreakdownItem[] }) {
  const scored = items.some((item) => item.cumulative_score > 0)
  const ranges = legendRanges(items)

  return (
    <>
      {/* Every skill is still listed below at zero — this says why they are all
          empty rather than leaving the learner to guess the page is broken. */}
      {!scored && (
        <EmptyState
          icon={CircleDashedIcon}
          title="Nothing scored yet"
          body="Finish a daily quiz or an exercise and your scores start filling in here."
        />
      )}

      <Legend ranges={ranges} />

      {groupByCategory(items).map((group, index) => (
        <section
          key={group.category}
          style={staggerStyle(index, { step: "40ms" })}
          className="enter-stagger flex flex-col gap-3.5"
        >
          <SectionLabel>{group.category}</SectionLabel>
          <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {group.items.map((item) => (
              <SkillCard key={item.skill_id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

// Decorative twice over: the colours are repeated on every badge, and every
// card already spells its own band out in words. It is a key, not content.
function Legend({ ranges }: { ranges: Record<Band, string> | null }) {
  return (
    <ul aria-hidden="true" className="label-micro flex flex-wrap items-center gap-x-3.5 gap-y-2">
      {BANDS.map((band) => (
        <li key={band} className="inline-flex items-center gap-1.5">
          <span
            className="size-1.5 rounded-[2px]"
            style={{ background: BAND_COLOR[band] }}
          />
          {BAND_LABEL[band]}
          {ranges !== null && ` ${ranges[band]}`}
        </li>
      ))}
    </ul>
  )
}

function SkillCard({ item }: { item: SkillBreakdownItem }) {
  const band = bandOf(item)
  const color = BAND_COLOR[band]

  return (
    <li className="surface flex flex-col gap-3.5 px-5 pt-4.5 pb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-medium break-words text-foreground">{item.skill_name}</h3>
          <p className="label-micro">{metaLine(item)}</p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0"
          style={{ color: bandInk(color), borderColor: color }}
        >
          {BAND_LABEL[band]}
        </Badge>
      </div>

      <p className="flex items-end gap-2">
        <span className="numeric text-3xl leading-none text-foreground">
          {item.cumulative_score}
        </span>
        <span className="label-micro pb-0.5">pts</span>
        <span className="sr-only">{srSentence(item, band)}</span>
      </p>

      <Track item={item} color={color} />
    </li>
  )
}

// The card above already states the score and the band in words, so the bar is
// hidden from screen readers rather than repeated at them — the same call
// SkillBandBar and ThresholdLadder make.
function Track({ item, color }: { item: SkillBreakdownItem; color: string }) {
  return (
    <div aria-hidden="true" className="relative pt-0.5">
      <div className="h-[5px] overflow-hidden rounded-[3px] bg-muted">
        <div
          className="h-full rounded-[3px]"
          style={{
            width: `${trackPercent(item.cumulative_score, item.intermediate_max)}%`,
            background: color,
          }}
        />
      </div>
      {/* The two cut points, drawn on the track they apply to. Darker than
          --border, which is tuned for card edges and vanishes against the
          track. */}
      <span
        className="absolute top-0 h-[9px] w-px bg-[color-mix(in_oklab,var(--border)_55%,var(--muted-foreground))]"
        style={{ left: `${trackPercent(item.basic_max, item.intermediate_max)}%` }}
      />
      <span
        className="absolute top-0 h-[9px] w-px bg-[color-mix(in_oklab,var(--border)_55%,var(--muted-foreground))]"
        style={{ left: `${(1 - ADVANCED_SHARE) * 100}%` }}
      />
    </div>
  )
}
