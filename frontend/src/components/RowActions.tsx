import { Fragment } from "react"
import { MoreHorizontalIcon, type LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// `icon` is required, not optional. Colour alone must not carry meaning, and a
// destructive item styled only in red would lean on exactly that — the same rule
// ResultBadge settled when it paired its colour with a word. Making the field
// required means no table can add a bare item later without noticing.
export type RowAction = {
  label: string
  icon: LucideIcon
  to?: string
  onSelect?: () => void
  destructive?: boolean
  disabled?: boolean
}

// One row-action pattern for every admin table. Before this, each page laid its
// actions out as three ghost buttons in the row, which cost 40-60 characters of
// column width and gave Delete permanent visual priority over Edit.
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  const firstDestructive = actions.findIndex((action) => action.destructive)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* TableRow styles itself off has-aria-expanded, and Button suppresses
            its press-translate for aria-haspopup — both were already in the
            design system waiting for a trigger like this one. */}
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${label}`}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        {actions.map((action, index) => {
          const Icon = action.icon
          return (
            <Fragment key={action.label}>
              {/* Destructive actions sit below a rule so they are not adjacent
                  to the routine ones in the hit area. */}
              {index === firstDestructive && index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={action.destructive === true ? "destructive" : "default"}
                disabled={action.disabled}
                onSelect={action.to === undefined ? action.onSelect : undefined}
                asChild={action.to !== undefined}
              >
                {action.to !== undefined ? (
                  <Link to={action.to}>
                    <Icon />
                    {action.label}
                  </Link>
                ) : (
                  <>
                    <Icon />
                    {action.label}
                  </>
                )}
              </DropdownMenuItem>
            </Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
