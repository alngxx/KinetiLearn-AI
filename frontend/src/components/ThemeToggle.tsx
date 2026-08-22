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
    <div role="group" aria-label="Theme" className="flex gap-0.5 rounded-lg border border-sidebar-border p-0.5">
      {options.map(({ value, label, Icon }) => (
        <Button
          key={value}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            theme === value && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
    </div>
  )
}
