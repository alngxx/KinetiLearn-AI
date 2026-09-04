import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PencilIcon, Trash2Icon } from "lucide-react"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"
import { RowActions } from "@/components/RowActions"

function renderActions(onDelete = vi.fn()) {
  render(
    <MemoryRouter>
      <RowActions
        label="Q1 onboarding"
        actions={[
          { label: "Edit", icon: PencilIcon, onSelect: vi.fn() },
          { label: "Delete", icon: Trash2Icon, destructive: true, onSelect: onDelete },
        ]}
      />
    </MemoryRouter>,
  )
  return onDelete
}

describe("RowActions", () => {
  it("names its trigger after the row it acts on", () => {
    renderActions()
    expect(screen.getByRole("button", { name: "Actions for Q1 onboarding" })).toBeInTheDocument()
  })

  // The rule ResultBadge set: meaning never rides on colour alone. A red-only
  // Delete would fail for anyone who cannot separate it from the item above.
  it("gives the destructive item an icon and a label, not just a colour", async () => {
    renderActions()
    await userEvent.click(screen.getByRole("button", { name: /^Actions for/ }))

    const remove = await screen.findByRole("menuitem", { name: "Delete" })
    expect(remove).toHaveAttribute("data-variant", "destructive")
    expect(remove.querySelector("svg")).toBeInTheDocument()
    expect(remove).toHaveTextContent("Delete")
  })

  it("gives every item an icon, so the menu reads consistently", async () => {
    renderActions()
    await userEvent.click(screen.getByRole("button", { name: /^Actions for/ }))

    const items = await screen.findAllByRole("menuitem")
    expect(items).toHaveLength(2)
    for (const item of items) expect(item.querySelector("svg")).toBeInTheDocument()
  })

  it("runs the action it was given", async () => {
    const onDelete = renderActions()
    await userEvent.click(screen.getByRole("button", { name: /^Actions for/ }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it("keeps a disabled action from firing", async () => {
    const onSelect = vi.fn()
    render(
      <MemoryRouter>
        <RowActions
          label="Locked"
          actions={[{ label: "Edit", icon: PencilIcon, disabled: true, onSelect }]}
        />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole("button", { name: /^Actions for/ }))
    const item = await screen.findByRole("menuitem", { name: "Edit" })
    expect(item).toHaveAttribute("data-disabled")
    await userEvent.click(item)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("renders a link action as a link", async () => {
    render(
      <MemoryRouter>
        <RowActions
          label="Mai"
          actions={[{ label: "Skills", icon: PencilIcon, to: "/admin/users/u1/skills" }]}
        />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole("button", { name: /^Actions for/ }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitem")).toHaveAttribute("href", "/admin/users/u1/skills")
  })

  it("renders an inline action as its own button and runs it on click", async () => {
    const onEdit = vi.fn()
    render(
      <MemoryRouter>
        <RowActions
          label="Q1 onboarding"
          actions={[{ label: "Delete", icon: Trash2Icon, destructive: true, onSelect: vi.fn() }]}
          inlineAction={{ label: "Edit", icon: PencilIcon, onSelect: onEdit }}
        />
      </MemoryRouter>,
    )
    const edit = screen.getByRole("button", { name: "Edit Q1 onboarding" })
    await userEvent.click(edit)
    expect(onEdit).toHaveBeenCalledOnce()
  })

  it("does not duplicate the inline action inside the menu", async () => {
    render(
      <MemoryRouter>
        <RowActions
          label="Q1 onboarding"
          actions={[{ label: "Delete", icon: Trash2Icon, destructive: true, onSelect: vi.fn() }]}
          inlineAction={{ label: "Edit", icon: PencilIcon, onSelect: vi.fn() }}
        />
      </MemoryRouter>,
    )
    await userEvent.click(screen.getByRole("button", { name: /^Actions for/ }))
    const items = await screen.findAllByRole("menuitem")
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent("Delete")
  })

  it("keeps a disabled inline action from firing", async () => {
    const onEdit = vi.fn()
    render(
      <MemoryRouter>
        <RowActions
          label="Locked"
          actions={[]}
          inlineAction={{ label: "Edit", icon: PencilIcon, disabled: true, onSelect: onEdit }}
        />
      </MemoryRouter>,
    )
    const edit = screen.getByRole("button", { name: "Edit Locked" })
    expect(edit).toBeDisabled()
    await userEvent.click(edit)
    expect(onEdit).not.toHaveBeenCalled()
  })
})
