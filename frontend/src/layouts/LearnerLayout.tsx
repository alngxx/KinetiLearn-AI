import { Outlet } from "react-router-dom"

// Shell only. Nav and learner screens land here in Task 34+.
export function LearnerLayout() {
  return (
    <main>
      <Outlet />
    </main>
  )
}
