import { useLayoutEffect, useRef, useState } from "react"

const ELLIPSIS = "…"

// -webkit-line-clamp's own ellipsis step trims character by character on the
// last visible line, not word by word, so long text reliably lands mid-word
// at some card width (verified while chasing a real bug: "give context,
// ru…"). This finds the longest whole-word prefix that still satisfies
// `fits`, so the cut always lands on a full word. `fits` is injected rather
// than measured in here, so the search itself can be tested without a real
// layout engine.
export function truncateToFit(text: string, fits: (candidate: string) => boolean): string {
  if (fits(text)) return text

  const words = text.split(" ")
  let lo = 0
  let hi = words.length

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(`${words.slice(0, mid).join(" ")}${ELLIPSIS}`)) lo = mid
    else hi = mid - 1
  }

  return `${words.slice(0, lo).join(" ")}${ELLIPSIS}`
}

// Clamps `text` to `lines` lines by measuring the actual element rather than
// trusting the browser's own line-clamp. Re-measures on resize, since the
// card grid's column width (and so how much text fits) changes with the
// viewport. The element still carries a max-height/overflow-hidden pair in
// its own className as a fallback for the first paint, before this has had a
// chance to run.
export function useClampedText<T extends HTMLElement>(text: string, lines: number) {
  const ref = useRef<T | null>(null)
  const [display, setDisplay] = useState(text)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return

    function measure() {
      const node = ref.current
      if (node === null) return

      const lineHeight = parseFloat(getComputedStyle(node).lineHeight)
      // jsdom (unit tests) never resolves a concrete line-height, so there is
      // nothing reliable to measure against there — show the current text in
      // full rather than trim against a NaN budget. Real browsers always
      // resolve one of these Tailwind text utilities to a px value.
      if (Number.isNaN(lineHeight)) {
        setDisplay(text)
        return
      }
      const maxHeight = lineHeight * lines + 1 // +1 for sub-pixel rounding

      const probe = node.cloneNode(false) as HTMLElement
      probe.style.position = "absolute"
      probe.style.visibility = "hidden"
      probe.style.height = "auto"
      probe.style.maxHeight = "none"
      probe.style.width = `${node.clientWidth}px`
      document.body.appendChild(probe)

      setDisplay(
        truncateToFit(text, (candidate) => {
          probe.textContent = candidate
          return probe.scrollHeight <= maxHeight
        }),
      )

      document.body.removeChild(probe)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, lines])

  return { ref, text: display }
}
