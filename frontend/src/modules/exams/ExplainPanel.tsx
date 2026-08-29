import { ArrowUpIcon, SparklesIcon, SquareIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Bubble } from "@/modules/chat/Bubble"
import { ChatStatusLine } from "@/modules/chat/ChatStatusLine"
import { useExplainChat } from "@/modules/chat/useExplainChat"

// Inline on the page rather than a second overlay. The header's Ask panel is a
// fixed sheet on a phone and a column beside the content from md up, so a copy
// of it here would land on top of the first one. Keeping this in the page
// column also keeps the two conversations obviously separate: different
// sessions, different requests, and only this one is tied to the exam.
export function ExplainPanel({ submissionId }: { submissionId: string }) {
  const explain = useExplainChat(submissionId)
  const [draft, setDraft] = useState("")
  const listRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [explain.messages])

  // Starting replaces the button that was pressed, so focus would land on
  // <body> and a keyboard user would lose their place on the page. The same
  // hand-off the learner layout makes when it closes the chat panel.
  useEffect(() => {
    if (explain.started) sectionRef.current?.focus()
  }, [explain.started])

  if (!explain.started) {
    return (
      <div className="flex flex-col items-start gap-2 surface p-5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Go over what you missed
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Walks through the questions you got wrong or skipped, drawn from the documents this exam
          was written from. The ones you answered correctly are not included.
        </p>
        <Button className="mt-1" onClick={() => void explain.start()}>
          <SparklesIcon />
          Explain my mistakes
        </Button>
      </div>
    )
  }

  function submit() {
    if (explain.busy || draft.trim() === "") return
    void explain.send(draft)
    setDraft("")
  }

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Explanation of your mistakes"
      className="flex flex-col gap-4 surface p-5 outline-none"
    >
      <h2 className="text-sm font-semibold tracking-tight text-foreground">
        Go over what you missed
      </h2>

      {/* tabIndex, because this scrolls: without it a long answer cannot be
          scrolled without a pointer. overscroll-contain, as in the chat panel:
          reaching the end of the answer must not start scrolling the page
          behind it. */}
      <div
        ref={listRef}
        tabIndex={0}
        aria-label="The explanation"
        className="flex max-h-[32rem] flex-col gap-4 overflow-y-auto overscroll-contain outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {explain.messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}
      </div>

      <ChatStatusLine status={explain.status} />

      {explain.busy ? (
        <Button variant="outline" className="self-start" onClick={explain.stop}>
          <SquareIcon />
          Stop
        </Button>
      ) : explain.canFollowUp ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            maxLength={4000}
            rows={2}
            name="follow-up"
            autoComplete="off"
            placeholder="Ask a follow-up…"
            aria-label="Ask a follow-up about these questions"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <Button className="self-start" disabled={draft.trim() === ""} onClick={submit}>
            <ArrowUpIcon />
            Send
          </Button>
        </div>
      ) : (
        // Nothing came back, so there is no session to ask a follow-up on. The
        // same button retries the explanation itself.
        <Button variant="outline" className="self-start" onClick={() => void explain.start()}>
          Try again
        </Button>
      )}
    </section>
  )
}
