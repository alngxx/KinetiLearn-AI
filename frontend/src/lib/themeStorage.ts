const THEME_KEY = "kinetilearn_theme"

export type Theme = "light" | "dark" | "system"

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system"
}

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  return isTheme(stored) ? stored : "system"
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme)
}
