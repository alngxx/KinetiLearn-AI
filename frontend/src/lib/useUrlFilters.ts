import { useSearchParams } from "react-router-dom"

// Filters live in the query string so a filtered list survives a reload, a
// Back navigation, and can be pasted to someone else. Missing means unset; an
// empty value is deleted from the URL rather than written as an empty param.
// Booleans are not a separate concept — a page that wants one just checks
// values.key === "1".
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [searchParams, setSearchParams] = useSearchParams()

  const values = {} as Record<K, string>
  for (const key of keys) values[key] = searchParams.get(key) ?? ""

  function setFilter(key: K, value: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === "") next.delete(key)
        else next.set(key, value)
        return next
      },
      // Matches the job-id pattern GenerateExamPage already uses. Without
      // replace, Back would undo one dropdown change at a time instead of
      // leaving the page — worse than not syncing filters at all.
      { replace: true },
    )
  }

  return { values, setFilter }
}
