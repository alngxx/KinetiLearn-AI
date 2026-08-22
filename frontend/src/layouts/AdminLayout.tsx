import { FileTextIcon, GraduationCapIcon, LogOutIcon, UsersIcon } from "lucide-react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { configEntities } from "@/modules/config/descriptors"
import { useAuth } from "@/modules/auth/useAuth"

const navLinkClasses =
  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"

// The active item carries the brass marker — the same accent the threshold
// ladder uses, so the colour means "this one" throughout the console.
const activeClasses =
  "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0_0_var(--sidebar-ring)]"

export function AdminLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-svh bg-background">
      {/* First thing in the tab order: skips the whole sidebar. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar px-3 py-5">
        <div className="px-2.5">
          <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
            KinetiLearn
          </span>
          <p className="label-micro mt-0.5">Admin</p>
        </div>

        <nav className="flex flex-col gap-5">
          <div className="flex flex-col gap-0.5">
            <span className="label-micro px-2.5 pb-1">People</span>
            <NavLink
              to="/admin/users"
              className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
            >
              <UsersIcon className="size-4" />
              Users
            </NavLink>
            <NavLink
              to="/admin/classes"
              className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
            >
              <GraduationCapIcon className="size-4" />
              Classes
            </NavLink>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="label-micro px-2.5 pb-1">Content</span>
            <NavLink
              to="/admin/documents"
              className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
            >
              <FileTextIcon className="size-4" />
              Documents
            </NavLink>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="label-micro px-2.5 pb-1">Configuration</span>
            {configEntities.map((entity) => (
              <NavLink
                key={entity.key}
                to={`/admin/config/${entity.key}`}
                className={({ isActive }) => cn(navLinkClasses, isActive && activeClasses)}
              >
                {entity.label}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="mt-auto flex flex-col gap-2">
          <ThemeToggle />

          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => {
              logout()
              navigate("/login", { replace: true })
            }}
          >
            <LogOutIcon />
            Sign out
          </Button>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-8 py-8 outline-none">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
