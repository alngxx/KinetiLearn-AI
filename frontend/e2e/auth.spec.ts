import { ADMIN, expect, signIn, test } from "./fixtures"

// None of these provision anything or depend on each other, so their order in the
// run does not matter.
test.describe("authentication", () => {
  test("rejects a wrong password without leaving the login page", async ({ page }) => {
    await page.goto("/login")
    await signIn(page, { email: ADMIN.email, password: "definitely-wrong" })

    await expect(page.getByRole("alert")).toHaveText("Invalid credentials")
    await expect(page).toHaveURL(/\/login/)
    expect(await page.evaluate(() => localStorage.getItem("kinetilearn_token"))).toBeNull()
  })

  test("returns to the deep link it interrupted", async ({ page }) => {
    await page.goto("/admin/users")
    // ProtectedRoute parks the attempted path in ?next= rather than dropping it.
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fusers/)

    await signIn(page, ADMIN)
    await expect(page).toHaveURL(/\/admin\/users$/)
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible()
  })

  test("signing out clears the session and closes the portal again", async ({ page }) => {
    await page.goto("/login")
    await signIn(page, ADMIN)
    await expect(page).toHaveURL(/\/admin/)

    await page.getByRole("button", { name: "Sign out" }).click()
    await expect(page).toHaveURL(/\/login/)

    const stored = await page.evaluate(() => ({
      token: localStorage.getItem("kinetilearn_token"),
      chat: localStorage.getItem("kinetilearn_chat_session"),
    }))
    expect(stored).toEqual({ token: null, chat: null })

    await page.goto("/admin")
    await expect(page).toHaveURL(/\/login/)
  })
})
