import { QueryErrorState } from "kinetilearn-frontend"

export function Failed() {
  return (
    <QueryErrorState
      title="Could not load classes"
      error={new Error("boom")}
      retrying={false}
      onRetry={() => {}}
    />
  )
}

export function Retrying() {
  return (
    <QueryErrorState
      title="Could not load classes"
      error={new Error("boom")}
      retrying={true}
      onRetry={() => {}}
    />
  )
}
