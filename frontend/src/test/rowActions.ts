import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Admin row actions sit behind a per-row menu, except for RowActions'
// inlineAction (Edit, on every current table), which renders as its own
// button directly in the row instead. The trigger for the menu is inside the
// row, but Radix portals the menu itself out to the body — so a menu item is
// never found with `within(row)`, which is the trap this helper exists to
// keep out of the tests.
export async function clickRowAction(row: HTMLElement, action: string) {
  const inline = within(row).queryByRole("button", { name: new RegExp(`^${action} `) })
  if (inline !== null) {
    await userEvent.click(inline)
    return
  }
  await userEvent.click(within(row).getByRole("button", { name: /^Actions for/ }))
  await userEvent.click(await screen.findByRole("menuitem", { name: action }))
}
