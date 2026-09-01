import type { Citation } from "@/modules/chat/api"

// The chunks the answer was retrieved from, so a learner can check it against
// the source. Content wraps rather than truncating — nothing in this app hides
// text behind a mouse-only title.
export function Citations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null

  return (
    <details className="mt-2 rounded-lg border border-border bg-background/60">
      <summary className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/75">
        {citations.length === 1 ? "1 source" : `${citations.length} sources`}
      </summary>
      <ul className="flex flex-col gap-3 px-2.5 pt-1 pb-2.5">
        {citations.map((citation) => (
          <li key={citation.document_chunk_id} className="flex flex-col gap-1">
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="font-medium break-words text-foreground">
                {citation.document_title}
              </span>
              <span className="numeric text-muted-foreground">
                part {citation.chunk_index + 1} · {Math.round(citation.relevance_score * 100)}%
                match
              </span>
            </p>
            <p className="text-xs break-words whitespace-normal text-muted-foreground">
              {citation.content}
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}
