import { Outlet } from "react-router-dom"

// Shell only. Nav and admin screens land here in Task 34+.
export function AdminLayout() {
  return (
    <main>
      <Outlet />
    </main>
  )
}
