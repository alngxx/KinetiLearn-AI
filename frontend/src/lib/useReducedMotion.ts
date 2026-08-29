import { useEffect, useState } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"

// CSS animations are already handled — index.css scopes them by media query.
// This is for the motion CSS cannot reach: Recharts drives its reveal from JS,
// so no stylesheet rule will stop it and the component has to ask.
// Same direct matchMedia call ThemeContext uses.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = () => setReduced(media.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return reduced
}
