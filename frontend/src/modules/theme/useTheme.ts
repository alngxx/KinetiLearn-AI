import { useContext } from "react"
import { ThemeContext, type ThemeState } from "@/modules/theme/ThemeContext"

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext)
  if (context === null) throw new Error("useTheme must be used inside ThemeProvider")
  return context
}
