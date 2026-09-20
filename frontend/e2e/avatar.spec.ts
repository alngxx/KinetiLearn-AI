import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test, expect, type Page } from "@playwright/test"
import { API_URL } from "../playwright.config"
import { ADMIN, LEARNER, signIn } from "./fixtures"

const assets = join(dirname(fileURLToPath(import.meta.url)), "assets")
const INDIGO = join(assets, "avatar-indigo.png")
const AMBER = join(assets, "avatar-amber.png")

// Anchored so it never also matches "Remove your photo", which appears
// alongside it once a picture is set.
const identity = (page: Page) =>
  page.locator("aside").getByRole("button", { name: /^(Add|Change your) a? ?photo$/ })
const nameText = (page: Page) => page.locator("aside span[title]").last()

async function adminToken(): Promise<string> {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ADMIN),
  })
  if (!response.ok) throw new Error(`Admin login failed: ${response.status}`)
  return ((await response.json()) as { access_token: string }).access_token
}

// The avatar is stored in a private bucket, so the only honest way to prove an
// object exists is to redeem the signed URL the API just handed the browser.
async function fetchAvatar(url: string) {
  const response = await fetch(url)
  return { status: response.status, bytes: (await response.arrayBuffer()).byteLength }
}

async function currentAvatarUrl(page: Page): Promise<string> {
  const img = identity(page).locator("img")
  await expect(img).toBeVisible()
  const src = await img.getAttribute("src")
  if (src === null) throw new Error("avatar image has no src")
  return src
}

// Every test signs in as the admin, so the avatar is shared state. Clearing it
// afterwards keeps the dev database as it was found and takes the R2 objects
// with it.
test.afterEach(async () => {
  const token = await adminToken()
  await fetch(`${API_URL}/api/v1/users/me/avatar`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  })
})

test("uploads a real image, replaces it, and removes it", async ({ page }) => {
  await page.goto("/login")
  await signIn(page, ADMIN)

  // Starts on the initials placeholder, next to the signed-in name.
  await expect(identity(page)).toHaveAccessibleName("Add a photo")
  await expect(identity(page)).toHaveText("AU")
  await expect(nameText(page)).toHaveText("Admin User")

  await page.locator("aside input[type=file]").setInputFiles(INDIGO)

  const first = await currentAvatarUrl(page)
  await expect(identity(page)).toHaveAccessibleName("Change your photo")

  // The object is really in R2: redeeming the signed URL returns the exact
  // bytes that were uploaded.
  const stored = await fetchAvatar(first)
  expect(stored.status).toBe(200)
  expect(stored.bytes).toBe(readFileSync(INDIGO).byteLength)

  // Replacing it writes a new key and takes the old object with it.
  await page.locator("aside input[type=file]").setInputFiles(AMBER)
  await expect.poll(async () => await currentAvatarUrl(page)).not.toBe(first)
  const second = await currentAvatarUrl(page)

  expect((await fetchAvatar(second)).bytes).toBe(readFileSync(AMBER).byteLength)
  expect((await fetchAvatar(first)).status).toBe(404)

  // Removing falls back to initials and leaves nothing behind.
  await page.locator("aside").getByRole("button", { name: "Remove your photo" }).click()
  await expect(identity(page)).toHaveText("AU")
  expect((await fetchAvatar(second)).status).toBe(404)
})

test("shows the server's rejection inline when the bytes are not an image", async ({ page }) => {
  await page.goto("/login")
  await signIn(page, ADMIN)

  // Labelled image/png so the client-side check passes and the request really
  // reaches the server, which sniffs the bytes rather than trusting the header.
  await page.locator("aside input[type=file]").setInputFiles({
    name: "pretend.png",
    mimeType: "image/png",
    buffer: Buffer.from("plain text, definitely not a picture"),
  })

  await expect(page.locator("aside").getByRole("alert")).toHaveText(
    "File must be a PNG, JPEG, or WebP image",
  )
  await expect(identity(page)).toHaveText("AU")
})

test("clamps a long name to the sidebar instead of overflowing it", async ({ page }) => {
  const token = await adminToken()
  const rename = (full_name: string) =>
    fetch(`${API_URL}/api/v1/users/${"ad639abf-becc-4ddc-91d7-d472554822cc"}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ full_name }),
    })

  await rename("Nguyen Thi Thu Ha")
  try {
    await page.goto("/login")
    await signIn(page, ADMIN)

    // Drag the sidebar to its 200px floor, where the name has the least room.
    await page.getByRole("separator", { name: "Resize sidebar" }).focus()
    await page.keyboard.press("Home")
    await expect(page.getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute(
      "aria-valuenow",
      "200",
    )

    const name = nameText(page)
    // The untruncated name stays reachable on hover and to assistive tech,
    // whatever the visible text ends up being.
    await expect(name).toHaveAttribute("title", "Nguyen Thi Thu Ha")

    const overflow = await name.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
      text: el.textContent ?? "",
    }))
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1)
    expect(overflow.text.length).toBeGreaterThan(0)
  } finally {
    await rename("Admin User")
  }
})

test("ellipsises a name that cannot fit at any sidebar width", async ({ page }) => {
  const token = await adminToken()
  const rename = (full_name: string) =>
    fetch(`${API_URL}/api/v1/users/${"ad639abf-becc-4ddc-91d7-d472554822cc"}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ full_name }),
    })

  await rename("Nguyen Thi Thu Ha Nguyen Thi Thu Ha Nguyen Thi Thu Ha")
  try {
    await page.goto("/login")
    await signIn(page, ADMIN)
    await page.getByRole("separator", { name: "Resize sidebar" }).focus()
    await page.keyboard.press("Home")

    const name = nameText(page)
    await expect(name).toHaveText(/…$/)
    const overflow = await name.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }))
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1)
  } finally {
    await rename("Admin User")
  }
})

// The learner portal has no sidebar — the same block sits in the header's
// right-hand cluster instead, so it needs its own render check.
test("renders the identity block in the learner header", async ({ page }) => {
  await page.goto("/login")
  await signIn(page, LEARNER)

  // .first(): learner pages render their own <header> inside the outlet, and
  // the layout's bar is the outer one.
  const header = page.locator("header").first()
  const avatar = header.getByRole("button", { name: /^(Add|Change your) a? ?photo$/ })

  await expect(avatar).toBeVisible()
  await expect(avatar).toHaveText("AN")
  await expect(header.locator("span[title]").last()).toHaveText("Alice Nguyen")

  // Sits between the portal label and the nav, with the theme control and
  // Sign out still further along in their own right-hand cluster.
  await expect(header.getByRole("link", { name: "Home" })).toBeVisible()
  await expect(header.getByRole("group", { name: "Theme" })).toBeVisible()
  await expect(header.getByRole("button", { name: "Sign out" })).toBeVisible()
})

// Regression for a real bug: the header's identity slot has no width of its
// own to measure against, and useClampedText's first pass raced that layout
// and over-truncated a name that had room to spare ("Mike Ross" rendered as
// "Mike…"). The header uses plain CSS truncation instead (AccountIdentity's
// `compact` mode), which has no measurement to race.
test("does not over-truncate a short name in the learner header", async ({ page }) => {
  await page.goto("/login")
  await signIn(page, LEARNER)

  const header = page.locator("header").first()
  const name = header.locator("span[title]").last()

  // The DOM text is the untruncated string — CSS ellipsis is visual only —
  // so this also confirms nothing clipped it before it ever reached the page.
  await expect(name).toHaveText("Alice Nguyen")
  const box = await name.boundingBox()
  const home = await header.getByRole("link", { name: "Home" }).boundingBox()
  if (box === null || home === null) throw new Error("missing bounding box")
  // The identity block sits between the portal label and the nav, so what it
  // hugs now is "Home" - the gap after it is the header's own deliberate
  // section spacing (gap-x-[26px] plus nav's own left margin), not a leftover
  // fixed-width box reserving dead space beyond that.
  expect(home.x - (box.x + box.width)).toBeLessThanOrEqual(40)
})

test("truncates a name too long for the header without overlapping the nav", async ({
  page,
}) => {
  const token = await adminToken()
  const learners = (await (
    await fetch(`${API_URL}/api/v1/users?role=learner`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json()) as { id: string; full_name: string; email: string }[]
  const alice = learners.find((u) => u.email === LEARNER.email)
  if (alice === undefined) throw new Error("seeded learner not found")

  const rename = (full_name: string) =>
    fetch(`${API_URL}/api/v1/users/${alice.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ full_name }),
    })

  await rename("Nguyen Thi Thu Ha Nguyen Thi Thu Ha")
  try {
    await page.goto("/login")
    await signIn(page, LEARNER)

    const header = page.locator("header").first()
    const name = header.locator("span[title]").last()
    const home = header.getByRole("link", { name: "Home" })

    await expect(name).toHaveAttribute("title", "Nguyen Thi Thu Ha Nguyen Thi Thu Ha")
    const overflow = await name.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }))
    // Visually clipped (scrollWidth exceeds the rendered box)...
    expect(overflow.scroll).toBeGreaterThan(overflow.client)

    // ...and never spills into the nav link right after it, the nearest thing
    // it could now overlap.
    const nameBox = await name.boundingBox()
    const homeBox = await home.boundingBox()
    if (nameBox === null || homeBox === null) throw new Error("missing bounding box")
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(homeBox.x)
  } finally {
    await rename(alice.full_name)
  }
})

// Regression for a real bug: a long nav list (Configuration has six entries)
// pushed the footer below the viewport with no way to reach it short of
// scrolling the whole page. The nav now scrolls internally so the identity
// block, theme toggle, and Sign out stay pinned and reachable.
test("keeps sign out reachable in the admin sidebar without scrolling the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 620 })
  await page.goto("/login")
  await signIn(page, ADMIN)

  const signOut = page.locator("aside").getByRole("button", { name: "Sign out" })
  await expect(signOut).toBeVisible()
  const box = await signOut.boundingBox()
  if (box === null) throw new Error("missing bounding box")
  expect(box.y + box.height).toBeLessThanOrEqual(620)

  // The nav content is still all there, just scrollable within its own region.
  const employeeLevels = page.locator("aside").getByRole("link", { name: "Employee Levels" })
  await employeeLevels.scrollIntoViewIfNeeded()
  await expect(employeeLevels).toBeVisible()
})

// Regression for a real bug: useMe()'s query key was just ["me"], and with
// staleTime: Infinity react-query never refetches it on its own. login() (as
// opposed to logout()) never clears the query cache, so signing in as a
// different account without first clicking "Sign out" kept serving the
// previous account's cached identity — the learner header showed the admin's
// name and avatar. The key is now scoped by the signed-in user's own id, so
// switching accounts always lands on a fresh cache entry.
test("shows the right identity after switching accounts without signing out first", async ({
  page,
}) => {
  await page.goto("/login")
  await page.getByRole("button", { name: "Log in as admins" }).click()
  await page.getByLabel("Email").fill(ADMIN.email)
  await page.getByLabel("Password").fill(ADMIN.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/admin/)
  await expect(page.locator("aside span[title]").last()).toHaveText("Admin User")

  // Straight to /login again, deliberately skipping "Sign out".
  await page.goto("/login")
  await signIn(page, LEARNER)
  await page.waitForURL(/\/learner/)

  await expect(page.locator("header").first().locator("span[title]").last()).toHaveText(
    "Alice Nguyen",
  )
})
