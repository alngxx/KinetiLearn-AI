import { ADMIN, LEARNER, expect, signIn, test } from "./fixtures"

// One scenario, so one test: the learner half only means anything after the admin
// half has run. Keeping it in a single body makes that ordering structural, and
// lets both halves share one class name rather than two values that have to agree.
test("a class created in the admin portal reaches the learner enrolled in it", async ({
  browser,
  runId,
}) => {
  const className = `e2e-${runId}`

  const adminContext = await browser.newContext()
  const admin = await adminContext.newPage()

  await test.step("the admin signs in and lands in the admin portal", async () => {
    await admin.goto("/login")
    await signIn(admin, ADMIN)
    // The console redirects its index to users, so match the section not the path.
    await expect(admin).toHaveURL(/\/admin/)
  })

  await test.step(`the admin creates ${className}`, async () => {
    await admin.getByRole("link", { name: "Classes" }).click()
    await admin.getByRole("button", { name: "New class" }).click()
    await admin.getByLabel("Name").fill(className)
    await admin.getByRole("button", { name: "Create" }).click()

    await expect(admin.getByText("Class created")).toBeVisible()
    await expect(admin.getByRole("link", { name: className })).toBeVisible()
  })

  await test.step("the class is still there after a reload", async () => {
    // A reload drops the query cache, so what comes back has been read from the
    // database rather than from an optimistic update.
    await admin.reload()
    await expect(admin.getByRole("link", { name: className })).toBeVisible()
  })

  await test.step("the admin enrols the learner", async () => {
    await admin.getByRole("link", { name: className }).click()
    await expect(admin.getByRole("heading", { name: className })).toBeVisible()

    await admin.getByRole("button", { name: "Bulk enrol" }).click()
    // The three filters together match exactly one seeded learner, alice.
    await admin.getByLabel("Department").selectOption({ label: "Sales" })
    await admin.getByLabel("Seniority").selectOption({ label: "Junior" })
    await admin.getByLabel("Employee level").selectOption({ label: "L1" })
    await admin.getByRole("button", { name: "Add to class" }).click()

    await expect(admin.getByRole("status")).toContainText(/[1-9]\d* (person|people) added/)
    await admin.getByRole("button", { name: "Done" }).click()
    // The count and the word are adjacent spans separated by a CSS gap rather
    // than whitespace, so the text content reads "1person enrolled".
    await expect(admin.getByText(/[1-9]\d*\s*(person|people) enrolled/)).toBeVisible()
  })

  // A separate context, so the learner arrives with their own storage and token
  // rather than inheriting the admin's session.
  const learnerContext = await browser.newContext()
  const learner = await learnerContext.newPage()

  await test.step("the learner signs in and lands in the learner portal", async () => {
    await learner.goto("/login")
    await signIn(learner, LEARNER)
    await expect(learner).toHaveURL(/\/learner$/)
  })

  await test.step(`the learner sees ${className} on their home`, async () => {
    // The whole point of the run: enrolment written by one role, over one
    // session, read back by another. No mocked suite can cover this.
    await expect(learner.getByRole("link", { name: new RegExp(className) })).toBeVisible()
  })

  await test.step("the learner opens the class", async () => {
    await learner.getByRole("link", { name: new RegExp(className) }).click()
    await expect(learner).toHaveURL(/\/learner\/classes\/[0-9a-f-]+$/)
    // Scoped to the page heading: the class name is also on the card that was
    // just clicked, so an unscoped heading match would pass without navigating.
    await expect(learner.getByRole("heading", { level: 1, name: className })).toBeVisible()
    await expect(learner.getByText("No exercises yet")).toBeVisible()
  })

  await test.step("the skills dashboard chunk loads", async () => {
    // Lazily imported along with Recharts, so this is the one place a broken
    // split point would show up.
    await learner.getByRole("link", { name: "Skills" }).click()
    await expect(learner.getByRole("heading", { name: "Your skills" })).toBeVisible()
  })

  await test.step("the learner cannot reach the admin portal", async () => {
    await learner.goto("/admin")
    await expect(learner).toHaveURL(/\/learner$/)
  })

  await adminContext.close()
  await learnerContext.close()
})
