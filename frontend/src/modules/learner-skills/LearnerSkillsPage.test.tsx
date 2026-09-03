import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { http, HttpResponse } from "msw"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { LearnerSkillsPage } from "@/modules/learner-skills/LearnerSkillsPage"
import { server } from "@/test/server"

const API = "http://localhost:8000"
const PATH = `${API}/api/v1/scoring/me/skills`

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/learner/skills"]}>
        <LearnerSkillsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function row(name: string, score: number, level: string, updated: string | null) {
  return {
    skill_id: name,
    skill_name: name,
    category_id: "cat1",
    category_name: "Technical",
    cumulative_score: score,
    current_level: level,
    basic_max: 200,
    intermediate_max: 500,
    last_updated_at: updated,
  }
}

const scored = [
  row("Python Programming", 300, "intermediate", "2026-03-01T00:00:00Z"),
  row("System Design", 600, "advanced", "2026-03-02T00:00:00Z"),
  row("Communication", 0, "basic", null),
]

const unscored = scored.map((item) =>
  row(item.skill_name, 0, "basic", null),
)

describe("LearnerSkillsPage", () => {
  it("lists every skill with its score, level and update line", async () => {
    server.use(http.get(PATH, () => HttpResponse.json(scored)))
    renderPage()

    // PageHeader renders before the query settles, so the wait has to be on
    // something only the loaded state has.
    expect(await screen.findByText("Technical")).toBeInTheDocument()
    expect(screen.getByText("Your skills")).toBeInTheDocument()

    const python = screen.getByText("Python Programming").closest("li")!
    expect(within(python).getByText("300")).toBeInTheDocument()
    expect(within(python).getByText("Intermediate")).toBeInTheDocument()
    expect(within(python).getByText(/Last scored/)).toBeInTheDocument()

    const design = screen.getByText("System Design").closest("li")!
    expect(within(design).getByText("Advanced")).toBeInTheDocument()
  })

  // The mixed state the endpoint really returns: an unscored skill is a zeroed
  // row, not a missing one.
  it("keeps an unscored skill in the list alongside scored ones", async () => {
    server.use(http.get(PATH, () => HttpResponse.json(scored)))
    renderPage()

    const comms = (await screen.findByText("Communication")).closest("li")!
    expect(within(comms).getByText("0")).toBeInTheDocument()
    expect(within(comms).getByText("Basic")).toBeInTheDocument()
    expect(within(comms).getByText("Not yet scored")).toBeInTheDocument()
  })

  it("keeps the nothing-scored panel away once anything has a score", async () => {
    server.use(http.get(PATH, () => HttpResponse.json(scored)))
    renderPage()

    expect(await screen.findByText("Technical")).toBeInTheDocument()
    expect(screen.queryByText("Nothing scored yet")).not.toBeInTheDocument()
  })

  // Every skill is still listed at zero — the panel explains the emptiness
  // rather than replacing the content.
  it("explains an all-zero page without hiding the skills", async () => {
    server.use(http.get(PATH, () => HttpResponse.json(unscored)))
    renderPage()

    expect(await screen.findByText("Nothing scored yet")).toBeInTheDocument()

    for (const name of ["Python Programming", "System Design", "Communication"]) {
      const item = screen.getByText(name).closest("li")!
      expect(within(item).getByText("0")).toBeInTheDocument()
      expect(within(item).getByText("Not yet scored")).toBeInTheDocument()
    }
  })

  it("says so when no skills are configured", async () => {
    server.use(http.get(PATH, () => HttpResponse.json([])))
    renderPage()

    expect(
      await screen.findByText("No skills have been set up for your training yet."),
    ).toBeInTheDocument()
    expect(screen.queryByText("Nothing scored yet")).not.toBeInTheDocument()
  })

  it("surfaces the API's message and a retry when the request fails", async () => {
    server.use(
      http.get(PATH, () =>
        HttpResponse.json({ detail: "Skill service unavailable." }, { status: 500 }),
      ),
    )
    renderPage()

    expect(await screen.findByText("Could not load your skills")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Skill service unavailable.")
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
  })
  // The mock's legend prints its thresholds because its skills all share them.
  // Ours are per-skill, so the numbers only appear when they are true of every
  // card under the legend.
  it("prints the band ranges only when every skill shares them", async () => {
    server.use(http.get(PATH, () => HttpResponse.json(scored)))
    const { unmount } = renderPage()

    expect(await screen.findByText(/Intermediate 201–500/)).toBeInTheDocument()
    unmount()

    const mixed = [scored[0], { ...scored[1], basic_max: 10, intermediate_max: 20 }]
    server.use(http.get(PATH, () => HttpResponse.json(mixed)))
    renderPage()

    expect(await screen.findByText("Technical")).toBeInTheDocument()
    expect(screen.queryByText(/Intermediate 201–500/)).not.toBeInTheDocument()
  })
})
