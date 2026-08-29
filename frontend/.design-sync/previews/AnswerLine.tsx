import { AnswerLine } from "kinetilearn-frontend"

export function Marked() {
  return (
    <div className="flex flex-col gap-3">
      <AnswerLine isCorrect={true} text="A retention policy defines how long processed documents are kept." />
      <AnswerLine isCorrect={false} text="Embeddings are regenerated on every chat request." />
      <AnswerLine isCorrect={null} text="Which retry strategy does the ingestion worker use?" />
    </div>
  )
}
