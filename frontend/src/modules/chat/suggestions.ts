import type { MyClass } from "@/modules/learner-home/api"

// Named after the class the learner is actually in, so the first thing the
// panel offers is about their own training rather than a generic prompt.
// Templates only — no LLM call: the class name is the whole substitution.
const cover = (name: string) => `What does ${name} cover?`
const keyPoints = (name: string) => `Summarise the key points from ${name}`
const revise = (name: string) => `What should I revise for ${name}?`

// Shown when there is nothing to name. Deliberately free of any reference to
// an exercise: a learner who reaches this has none, and offering to help them
// revise for one promises something that does not exist.
const GENERIC = [
  "What topics does my training cover?",
  "Summarise the key points I should remember",
  "What can you help me with?",
]

const COUNT = 3

// The panel renders these with key={question}, and two classes may legitimately
// carry the same name, so duplicates have to go before the slice rather than
// being tolerated as a rendering quirk.
function dedupe(questions: string[]): string[] {
  return [...new Set(questions)]
}

// `classes` is what GET /classes/me returned: already active-only and already
// in the server's order, so neither is re-derived here. Anything that is not a
// loaded, non-empty list falls back to GENERIC, which covers the pending and
// error states too — the panel should never render an empty row of chips.
export function suggestionsFor(classes: MyClass[] | undefined): string[] {
  if (classes === undefined || classes.length === 0) return GENERIC

  const withWork = classes.filter((row) => row.exercise_count > 0)
  const candidates = classes.map((row) => cover(row.name))

  // Only offered when there is an exercise to revise for. A class with none
  // skips this and falls through to the generic padding below, which is what
  // makes "enrolled but nothing assigned" read differently from "enrolled".
  if (withWork.length > 0) candidates.push(revise(withWork[0].name))
  candidates.push(keyPoints(classes[0].name))

  return dedupe([...candidates, ...GENERIC]).slice(0, COUNT)
}
