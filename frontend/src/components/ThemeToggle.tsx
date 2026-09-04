import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Theme } from "@/lib/themeStorage"
import { useTheme } from "@/modules/theme/useTheme"

const options: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: "light", label: "Light theme", Icon: SunIcon },
  { value: "system", label: "System theme", Icon: MonitorIcon },
  { value: "dark", label: "Dark theme", Icon: MoonIcon },
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex w-fit items-center gap-1 rounded-xl border border-sidebar-border p-1 bg-sidebar/50"
    >
      {options.map(({ value, label, Icon }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "size-8 rounded-lg text-sidebar-foreground/70 transition-all hover:bg-sidebar-accent hover:text-sidebar-foreground",
            theme === value && "bg-sidebar-accent text-sidebar-accent-foreground shadow-xs",
          )}
        >
          <Icon className="size-4.5" />
        </Button>
      ))}
    </div>
  )
}
