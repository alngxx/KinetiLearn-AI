import { randomBytes } from "node:crypto"
import { test as base, expect, type Page } from "@playwright/test"
import { API_URL } from "../playwright.config"

export const ADMIN = { email: "admin@kinetilearn.com", password: "admin1234" }
export const LEARNER = { email: "alice@kinetilearn.com", password: "learner1234" }

type ClassRow = { id: string; name: string }

async function adminToken(): Promise<string> {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ADMIN),
  })
  if (!response.ok) throw new Error(`Admin login failed: ${response.status}`)
  return ((await response.json()) as { access_token: string }).access_token
}

// Deletes by exact name, not by prefix: the dev database already holds rows from
// earlier manual passes ("E2E cb0f1a"), and teardown must not touch them.
// class_members cascades, so removing the class removes the enrolment with it.
async function deleteClassNamed(name: string): Promise<void> {
  const token = await adminToken()
  const headers = { Authorization: `Bearer ${token}` }

  const response = await fetch(`${API_URL}/api/v1/classes?include_inactive=true`, { headers })
  if (!response.ok) throw new Error(`Could not list classes: ${response.status}`)

  const rows = (await response.json()) as ClassRow[]
  for (const row of rows.filter((candidate) => candidate.name === name)) {
    const deleted = await fetch(`${API_URL}/api/v1/classes/${row.id}`, {
      method: "DELETE",
      headers,
    })
    if (!deleted.ok) throw new Error(`Could not delete ${row.name}: ${deleted.status}`)
  }
}

// The test body is handed this exact id, and teardown closes over the same one,
// so the two can never drift apart. Teardown runs even when the test fails.
export const test = base.extend<{ runId: string }>({
  // Playwright reads the destructured parameter to work out a fixture's
  // dependencies. This one has none, and the empty pattern is how that is spelled.
  // eslint-disable-next-line no-empty-pattern
  runId: async ({}, use) => {
    const id = randomBytes(3).toString("hex")
    await use(id)
    await deleteClassNamed(`e2e-${id}`)
  },
})

export { expect }

export async function signIn(page: Page, who: { email: string; password: string }) {
  await page.getByLabel("Email").fill(who.email)
  await page.getByLabel("Password").fill(who.password)
  await page.getByRole("button", { name: "Sign in" }).click()
}
