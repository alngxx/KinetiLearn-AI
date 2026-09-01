import { describe, expect, it } from "vitest"
import { suggestionsFor } from "@/modules/chat/suggestions"
import type { MyClass } from "@/modules/learner-home/api"

function klass(name: string, exerciseCount: number): MyClass {
  return {
    id: name,
    name,
    description: null,
    start_date: null,
    end_date: null,
    enrolled_at: "2026-01-01T00:00:00Z",
    exercise_count: exerciseCount,
    completed_exercise_count: 0,
  }
}

describe("suggestionsFor", () => {
  it("names one class per slot once there are three to name", () => {
    const questions = suggestionsFor([
      klass("Fire safety", 2),
      klass("Data privacy", 1),
      klass("Onboarding", 3),
    ])

    expect(questions).toEqual([
      "What does Fire safety cover?",
      "What does Data privacy cover?",
      "What does Onboarding cover?",
    ])
  })

  // Two classes fill two slots; the third comes from the class the learner has
  // work in rather than from generic filler.
  it("falls back to a second template when there are only two classes", () => {
    const questions = suggestionsFor([klass("Fire safety", 2), klass("Data privacy", 1)])

    expect(questions).toEqual([
      "What does Fire safety cover?",
      "What does Data privacy cover?",
      "What should I revise for Fire safety?",
    ])
  })

  it("spends all three slots on the only class there is", () => {
    const questions = suggestionsFor([klass("Fire safety", 2)])

    expect(questions).toEqual([
      "What does Fire safety cover?",
      "What should I revise for Fire safety?",
      "Summarise the key points from Fire safety",
    ])
  })

  // The whole point of the exercise_count gate: with nothing assigned there is
  // nothing to revise for, so offering it would promise work that does not
  // exist. The class is still named — that is what separates this from the
  // not-enrolled case.
  it("never offers to revise for a class with no exercises", () => {
    const questions = suggestionsFor([klass("Fire safety", 0)])

    expect(questions).toEqual([
      "What does Fire safety cover?",
      "Summarise the key points from Fire safety",
      "What topics does my training cover?",
    ])
    expect(questions.some((question) => question.includes("revise"))).toBe(false)
  })

  it("picks the revise slot from the first class that actually has exercises", () => {
    const questions = suggestionsFor([klass("Fire safety", 0), klass("Data privacy", 4)])

    expect(questions).toContain("What should I revise for Data privacy?")
  })

  // key={question} in ChatPanel, so a repeated string would collide in React.
  it("drops duplicates when two classes share a name", () => {
    const questions = suggestionsFor([klass("Fire safety", 1), klass("Fire safety", 1)])

    expect(questions).toEqual([...new Set(questions)])
    expect(questions).toHaveLength(3)
    expect(questions[0]).toBe("What does Fire safety cover?")
  })

  it("uses generic questions, with no exercise language, when nothing is enrolled", () => {
    const questions = suggestionsFor([])

    expect(questions).toEqual([
      "What topics does my training cover?",
      "Summarise the key points I should remember",
      "What can you help me with?",
    ])
    expect(questions.some((question) => question.includes("exercise"))).toBe(false)
  })

  // Pending and failed both arrive as undefined; the panel still has to render
  // three chips rather than an empty row.
  it("treats an unloaded list as the generic case", () => {
    expect(suggestionsFor(undefined)).toHaveLength(3)
    expect(suggestionsFor(undefined)[0]).toBe("What topics does my training cover?")
  })

  it("always returns exactly three", () => {
    const many = Array.from({ length: 9 }, (_, index) => klass(`Class ${index}`, index))
    expect(suggestionsFor(many)).toHaveLength(3)
  })
})
