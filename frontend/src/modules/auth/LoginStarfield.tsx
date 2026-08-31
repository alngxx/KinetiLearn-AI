import type { CSSProperties } from "react"

// The design handoff ships the starfield as ~37KB of hand-placed markup. Same
// field, generated instead: a fixed seed means every build, every reload and
// every screenshot get the identical sky, so this stays as reviewable as a
// literal while costing four lines.
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// Micro-dots are painted as one tiled background rather than as elements: a
// 340px tile of 42 dots covers a desktop viewport with roughly 600 of them, and
// the second, denser tile brings the field to about a thousand. Doing that with
// a thousand DOM nodes would be a thousand nodes for pure texture.
function dotLayer(count: number, tile: number, color: string, seed: number): CSSProperties {
  const random = seeded(seed)
  const dots = Array.from({ length: count }, () => {
    const radius = random() < 0.45 ? 1 : 1.5
    const x = Math.round(random() * tile)
    const y = Math.round(random() * tile)
    return `radial-gradient(circle ${radius}px at ${x}px ${y}px,${color} 0 45%,transparent 100%)`
  })

  return {
    backgroundImage: dots.join(","),
    backgroundSize: dots.map(() => `${tile}px ${tile}px`).join(","),
  }
}

// The four-point sparkles are the visible layer, so they are real elements with
// their own staggered twinkle. 130 of them, sized 3-8px.
const SPARKLE_CLIP =
  "polygon(50% 0%,61% 35%,100% 50%,61% 65%,50% 100%,39% 65%,0% 50%,39% 35%)"
const SPARKLE_COLORS = ["var(--kl-star-a)", "var(--kl-star-b)", "var(--kl-star-c)"]

const sparkles = (() => {
  const random = seeded(0x5eed)
  return Array.from({ length: 130 }, (_, index) => {
    const size = 3 + Math.round(random() * 5)
    return {
      key: index,
      left: `${(random() * 100).toFixed(1)}%`,
      top: `${(random() * 100).toFixed(1)}%`,
      width: `${size}px`,
      height: `${size}px`,
      background: SPARKLE_COLORS[Math.floor(random() * SPARKLE_COLORS.length)],
      clipPath: SPARKLE_CLIP,
      animation: `kl-twinkle ${(4.5 + random() * 3.5).toFixed(1)}s ease-in-out infinite`,
    } satisfies CSSProperties & { key: number }
  })
})()

const FAR_DOTS = dotLayer(42, 340, "var(--kl-star-c)", 0xc0ffee)
const NEAR_DOTS = dotLayer(26, 240, "var(--kl-star-b)", 0xbadf00d)

export function LoginStarfield() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ animation: "kl-twinkle 6s ease-in-out infinite" }}
      >
        <div className="absolute inset-0" style={FAR_DOTS} />
        <div className="absolute inset-0" style={NEAR_DOTS} />
      </div>
      <div className="absolute inset-0">
        {sparkles.map(({ key, ...style }) => (
          <span key={key} className="absolute" style={style} />
        ))}
      </div>
    </div>
  )
}
