import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useReducedMotion } from "@/lib/useReducedMotion"

type Listener = () => void

// A media query whose value can be changed after mount, so the hook's listener
// is exercised rather than only its initial read.
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const query = { matches: initial }
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return query.matches
      },
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: (_: string, fn: Listener) => listeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    })),
  )
  return {
    set(next: boolean) {
      query.matches = next
      for (const fn of listeners) fn()
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("useReducedMotion", () => {
  it("reports no preference as false", () => {
    stubMatchMedia(false)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false)
  })

  // Recharts reads this to decide whether to animate at all. The global CSS
  // rule cannot reach a JS-driven animation, so a wrong answer here is the
  // difference between respecting the preference and ignoring it.
  it("reports a reduce preference as true on first render", () => {
    stubMatchMedia(true)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true)
  })

  it("follows the preference changing after mount", () => {
    const media = stubMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    act(() => media.set(true))
    expect(result.current).toBe(true)
  })

  it("drops its listener on unmount", () => {
    const media = stubMatchMedia(false)
    const { unmount } = renderHook(() => useReducedMotion())
    expect(media.listenerCount).toBe(1)

    unmount()
    expect(media.listenerCount).toBe(0)
  })
})
