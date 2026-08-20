import { expect, test } from "@playwright/test"

/**
 * The Safari bundle, served and driven against a real daemon.
 *
 * Two things are worth proving outside a Safari window, and both are proved
 * here against the artifact `bun run build:safari` actually produces:
 *
 * 1. The build is daemon-only. Its manifest claims no bookmarks permission,
 *    no omnibox and no new-tab override, and the page it loads has no
 *    bookmarks API to fall back on — so the dashboard's only path in is a
 *    connected daemon Vault, and it says so.
 * 2. A change made to the Vault by something other than this page reaches it
 *    live, over the daemon's change stream, with no reload.
 *
 * What this cannot prove is anything about Safari itself: Chromium is the
 * browser here. The manual checklist in docs/SAFARI.md covers the rest.
 */

// Never the product default (52222): the fallback matches run-safari.sh's
// isolated default port, so running this spec directly cannot touch a real
// daemon or a real vault. run-safari.sh always exports the override.
const baseUrl =
  process.env.BOOKMARKS_BUT_BETTER_E2E_SAFARI_BASE_URL ??
  "http://127.0.0.1:52227"

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, init)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} → ${response.status}: ${text}`
    )
  }
  return text.length > 0 ? JSON.parse(text) : undefined
}

async function post(path: string, body: unknown) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

interface Node {
  id: string
  title: string
  children?: Node[]
}

async function rootId(): Promise<string> {
  const { tree } = (await api("/tree")) as { tree: Node[] }
  return tree[0].id
}

/**
 * Past the setup wizard and onto the dashboard. A fresh profile always runs
 * it, and this build's wizard has no source question to answer: there is no
 * Browser Source to choose.
 */
async function completeOnboarding(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Get Started" }).click()
  // The wizard slides its steps; let the transition settle before skipping.
  await page.waitForTimeout(450)
  await page.getByRole("button", { name: "Skip, use defaults" }).click()
}

test("the shipped Safari bundle claims no capability Safari does not have", async () => {
  const response = await fetch(`${baseUrl}/manifest.json`)
  expect(response.ok).toBe(true)
  const manifest = (await response.json()) as Record<string, unknown>

  expect(manifest.permissions).not.toContain("bookmarks")
  expect(manifest.omnibox).toBeUndefined()
  expect(manifest.chrome_url_overrides).toBeUndefined()
  // Loopback stays optional: nothing is requested until the user connects.
  expect(manifest.optional_host_permissions).toEqual([
    "http://127.0.0.1/*",
    "http://localhost/*",
  ])
})

test("the Safari build has no bookmarks API and says the daemon is the way in", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  await page.goto(baseUrl)

  // The capability the whole daemon-only design rests on: absent.
  const hasBookmarksApi = await page.evaluate(
    () =>
      typeof (globalThis as { chrome?: { bookmarks?: unknown } }).chrome !==
        "undefined" &&
      typeof (globalThis as { chrome?: { bookmarks?: unknown } }).chrome
        ?.bookmarks !== "undefined"
  )
  expect(hasBookmarksApi).toBe(false)

  await completeOnboarding(page)

  await expect(page.getByText("No bookmark source yet.")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Connect a daemon" })
  ).toBeVisible()
  // Nothing to switch between, and no Browser Source to switch to.
  await expect(page.getByRole("tab")).toHaveCount(0)

  expect(errors).toEqual([])
})

test("a connected Vault is the only source, and an external change arrives live", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  const folder = (await post("/folders", {
    parentId: await rootId(),
    title: "Safari Vault",
  })) as Node
  await post("/bookmarks", {
    parentId: folder.id,
    title: "Seeded Before Connect",
    url: "https://example.com/seeded",
  })

  await page.goto(baseUrl)
  await completeOnboarding(page)

  // The connect flow the daemon-only build depends on: address, Connect, and
  // the Vault becomes the source — live, with no reload.
  await page.getByRole("button", { name: "Connect a daemon" }).click()
  const settings = page.getByRole("dialog")
  await settings.getByRole("tab", { name: "Sources" }).click()
  await settings.getByLabel("Daemon address").fill(baseUrl)
  await settings.getByRole("button", { name: "Connect", exact: true }).click()
  await page.keyboard.press("Escape")

  await expect(
    page.getByText("Seeded Before Connect", { exact: true })
  ).toBeVisible({ timeout: 15_000 })

  // Written by another client of the same daemon — nothing this page did.
  await post("/bookmarks", {
    parentId: folder.id,
    title: "Arrived Over The Change Stream",
    url: "https://example.com/live",
  })

  await expect(
    page.getByText("Arrived Over The Change Stream", { exact: true })
  ).toBeVisible({ timeout: 15_000 })

  expect(errors).toEqual([])
})
