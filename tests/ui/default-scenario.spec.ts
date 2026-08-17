import { expect, test } from "@playwright/test"

/**
 * The default scenario: `bun run dev` opened plain, from a clean browser
 * profile — no extension APIs, no daemon. The workbench's default world must
 * already be the full product: browser bookmarks plus the reading and
 * archive Vaults.
 */

test("the default scenario provides Browser plus the reading and archive vaults", async ({
  page,
}) => {
  await page.goto("/")

  const tabs = page
    .getByRole("tablist", { name: "Bookmark source" })
    .getByRole("tab")
  await expect(tabs).toHaveCount(3)
  await expect(tabs.filter({ hasText: "Browser bookmarks" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(tabs.filter({ hasText: "reading" })).toBeVisible()
  await expect(tabs.filter({ hasText: "archive" })).toBeVisible()

  // The Browser source is active and shows its seeded bookmarks.
  await expect(page.getByText("MDN Web Docs")).toBeVisible()
  await expect(page.getByText("Hacker News")).toBeVisible()
})

test("bookmarks show letter avatars — the dev world has no favicon URLs, and an empty src must not render a blank tile", async ({
  page,
}) => {
  await page.goto("/")

  // Every dev adapter returns an empty favicon URL, so each bookmark falls
  // back to the first letter of its domain (an <img src=""> fires no error
  // event in Chromium; the fallback must engage without one).
  const mdn = page.locator("span[aria-label='MDN Web Docs']")
  await expect(mdn).toHaveText("D") // developer.mozilla.org
  await expect(page.locator("span[aria-label='Hacker News']")).toHaveText("N") // news.ycombinator.com

  // The letter avatars are spans, not blank img tiles.
  await expect(page.locator("img[src='']")).toHaveCount(0)
})

test("the workbench is present, collapsed, and reports the scenario", async ({
  page,
}) => {
  await page.goto("/")

  await expect(
    page.getByRole("button", { name: "Open Dev Workbench" })
  ).toBeVisible()

  await page.getByRole("button", { name: "Open Dev Workbench" }).click()
  const panel = page.getByRole("complementary", { name: "Dev Workbench" })
  await expect(panel).toBeVisible()
  await expect(panel).toContainText("Browser + daemon")
})
