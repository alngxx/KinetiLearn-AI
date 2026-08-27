import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { useUrlFilters } from "@/lib/useUrlFilters"

const KEYS = ["category_id", "inactive"] as const

function Probe() {
  const { values, setFilter } = useUrlFilters(KEYS)
  const location = useLocation()
  const navigationType = useNavigationType()

  return (
    <div>
      <p data-testid="search">{location.search}</p>
      <p data-testid="nav-type">{navigationType}</p>
      <p data-testid="category">{values.category_id === "" ? "(unset)" : values.category_id}</p>
      <button onClick={() => setFilter("category_id", "cat1")}>Set category</button>
      <button onClick={() => setFilter("category_id", "")}>Clear category</button>
      <button onClick={() => setFilter("inactive", "1")}>Show inactive</button>
    </div>
  )
}

function renderProbe(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Probe />
    </MemoryRouter>,
  )
}

describe("useUrlFilters", () => {
  it("reads a value already present in the URL", () => {
    renderProbe(["/x?category_id=cat1"])
    expect(screen.getByTestId("category")).toHaveTextContent("cat1")
  })

  it("reports a missing param as unset rather than throwing", () => {
    renderProbe(["/x"])
    expect(screen.getByTestId("category")).toHaveTextContent("(unset)")
  })

  it("writes a filter into the URL", async () => {
    renderProbe(["/x"])
    await userEvent.click(screen.getByRole("button", { name: "Set category" }))
    expect(screen.getByTestId("search")).toHaveTextContent("category_id=cat1")
    expect(screen.getByTestId("category")).toHaveTextContent("cat1")
  })

  it("deletes the param from the URL when set back to empty, rather than writing an empty value", async () => {
    renderProbe(["/x?category_id=cat1"])
    await userEvent.click(screen.getByRole("button", { name: "Clear category" }))
    expect(screen.getByTestId("search")).toHaveTextContent("")
    expect(screen.getByTestId("category")).toHaveTextContent("(unset)")
  })

  it("leaves other filters in the URL untouched", async () => {
    renderProbe(["/x?category_id=cat1"])
    await userEvent.click(screen.getByRole("button", { name: "Show inactive" }))
    const search = screen.getByTestId("search").textContent ?? ""
    expect(search).toContain("category_id=cat1")
    expect(search).toContain("inactive=1")
  })

  // A dropdown change must not grow the history stack — otherwise Back would
  // undo one filter change at a time instead of leaving the page.
  it("navigates with replace, not push", async () => {
    renderProbe(["/x"])
    expect(screen.getByTestId("nav-type")).toHaveTextContent("POP")
    await userEvent.click(screen.getByRole("button", { name: "Set category" }))
    expect(screen.getByTestId("nav-type")).toHaveTextContent("REPLACE")
  })
})
