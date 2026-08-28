import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts"
import { BASIC_RING, INTERMEDIATE_RING, type RadarPoint } from "@/modules/scoring/skillRadar"

type TickProps = {
  x?: number
  y?: number
  textAnchor?: "start" | "middle" | "end" | "inherit"
  payload?: { value?: string }
}

// Skill names are free text and several of the seeded ones are two words wide,
// which run off the edge of the plot on the left and right axes. Wrapping at
// the last space keeps the whole name readable instead of truncating it.
function AxisTick({ x = 0, y = 0, textAnchor, payload }: TickProps) {
  const label = payload?.value ?? ""
  const split = label.length > 14 ? label.lastIndexOf(" ") : -1
  const lines = split === -1 ? [label] : [label.slice(0, split), label.slice(split + 1)]

  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fill="var(--muted-foreground)"
      fontSize={11}
      // Two lines are centred on the axis point rather than hanging below it.
      dy={lines.length === 2 ? -2 : 4}
    >
      {lines.map((line, index) => (
        <tspan key={line} x={x} dy={index === 0 ? 0 : 13}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

// Every colour is a design token rather than a Recharts default, so the chart
// re-themes with the rest of the app instead of staying light in dark mode.
// The whole SVG is hidden from screen readers — a polygon read aloud says
// nothing — and the skill list beside it carries the same numbers as text, the
// same call ThresholdLadder and SkillBandBar already make.
export function SkillRadarChart({ points }: { points: RadarPoint[] }) {
  return (
    <div aria-hidden="true">
      <ResponsiveContainer width="100%" height={340}>
        <RadarChart
          data={points}
          outerRadius="70%"
          margin={{ top: 16, right: 48, bottom: 16, left: 48 }}
          // Recharts defaults this to true for RadarChart, which puts
          // tabIndex="0" on the chart surface. Inside an aria-hidden wrapper
          // that is a focus stop a screen reader cannot see, so it is turned
          // off and the skill list below is the keyboard path to this data.
          accessibilityLayer={false}
        >
          <PolarGrid gridType="polygon" stroke="var(--input)" />
          <PolarAngleAxis dataKey="skill" tick={<AxisTick />} />
          {/* Rings land on the band ceilings: the axis ticks are what PolarGrid
              draws its rings from, so these three values place them exactly. */}
          <PolarRadiusAxis
            domain={[0, 100]}
            ticks={[BASIC_RING, INTERMEDIATE_RING, 100]}
            tick={false}
            axisLine={false}
          />
          <Radar
            dataKey="progress"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="var(--chart-1)"
            fillOpacity={0.18}
            dot={{ r: 3, fill: "var(--chart-1)", stroke: "none" }}
            // Chart reveal animation is deferred to the project-wide motion pass.
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
