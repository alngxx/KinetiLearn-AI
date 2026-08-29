import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Admin row actions sit behind a per-row menu. The trigger is inside the row,
// but Radix portals the menu out to the body — so the item is never found with
// `within(row)`, which is the trap this helper exists to keep out of the tests.
export async function clickRowAction(row: HTMLElement, action: string) {
  await userEvent.click(within(row).getByRole("button", { name: /^Actions for/ }))
  await userEvent.click(await screen.findByRole("menuitem", { name: action }))
}
