import type { CSSProperties } from "react"

// Past the cap every item shares the last delay, so a long table still finishes
// settling in well under a second instead of trickling for seconds.
const DEFAULT_CAP = 12

// Rows are dense and numerous, so they step fast; cards are few and large, so
// they get a longer beat. Callers name the step rather than inheriting one.
export function staggerStyle(
  index: number,
  { cap = DEFAULT_CAP, step }: { cap?: number; step?: string } = {},
): CSSProperties {
  return {
    "--enter-index": Math.min(index, cap),
    ...(step === undefined ? {} : { "--enter-step": step }),
  } as CSSProperties
}
