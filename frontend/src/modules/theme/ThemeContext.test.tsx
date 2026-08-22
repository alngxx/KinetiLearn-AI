import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getStoredTheme, setStoredTheme } from "@/lib/themeStorage"
import { ThemeProvider } from "@/modules/theme/ThemeContext"
import { useTheme } from "@/modules/theme/useTheme"

function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<() => void>()
  const mql = {
    get matches() {
      return matches
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_event: string, handler: () => void) => listeners.add(handler),
    removeEventListener: (_event: string, handler: () => void) => listeners.delete(handler),
  }
  vi.stubGlobal("matchMedia", vi.fn(() => mql))
  return {
    setMatches(next: boolean) {
      matches = next
      listeners.forEach((handler) => handler())
    },
  }
}

function ThemeProbe() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("system")}>system</button>
    </div>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.classList.remove("dark")
})

describe("ThemeProvider", () => {
  it("defaults to system and resolves from the OS preference", () => {
    stubMatchMedia(true)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(screen.getByTestId("theme")).toHaveTextContent("system")
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("persists an explicit selection to localStorage and applies the class", async () => {
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    await userEvent.click(screen.getByRole("button", { name: "dark" }))

    expect(screen.getByTestId("resolved")).toHaveTextContent("dark")
    expect(getStoredTheme()).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("hydrates an explicit choice already in storage on boot", () => {
    setStoredTheme("dark")
    stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    expect(screen.getByTestId("theme")).toHaveTextContent("dark")
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark")
  })

  it("follows a live OS preference change while set to system", () => {
    const media = stubMatchMedia(false)
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId("resolved")).toHaveTextContent("light")

    act(() => media.setMatches(true))

    expect(screen.getByTestId("resolved")).toHaveTextContent("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })
})
