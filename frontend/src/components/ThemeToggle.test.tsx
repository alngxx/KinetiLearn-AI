import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ThemeToggle } from "@/components/ThemeToggle"
import { ThemeProvider } from "@/modules/theme/ThemeContext"

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function renderToggle() {
  stubMatchMedia(false)
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.classList.remove("dark")
})

describe("ThemeToggle", () => {
  it("renders a labeled group with all three theme buttons", () => {
    renderToggle()

    expect(screen.getByRole("group", { name: "Theme" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Light theme" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "System theme" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Dark theme" })).toBeInTheDocument()
  })

  it("marks system pressed by default", () => {
    renderToggle()

    expect(screen.getByRole("button", { name: "System theme" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "false")
  })

  it("clicking dark selects it, applies the class, and deselects the others", async () => {
    renderToggle()

    await userEvent.click(screen.getByRole("button", { name: "Dark theme" }))

    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "System theme" })).toHaveAttribute("aria-pressed", "false")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("clicking light selects it and removes the dark class", async () => {
    renderToggle()

    await userEvent.click(screen.getByRole("button", { name: "Dark theme" }))
    await userEvent.click(screen.getByRole("button", { name: "Light theme" }))

    expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "false")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })
})
