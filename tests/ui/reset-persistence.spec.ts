import { expect, test } from "@playwright/test"

/**
 * Scenario persistence and deterministic reset: changes made while
 * developing (including real bookmark mutations) survive reloads, and Reset
 * Scenario restores the seed exactly.
 */

test("mutations persist across reloads, and Reset Scenario restores the seed", async ({
  page,
}) => {
  await page.goto("/?scenario=browser-daemon")

  const tabs = page
    .getByRole("tablist", { name: "Bookmark source" })
    .getByRole("tab")
  await tabs.filter({ hasText: "archive" }).click()
  await expect(page.getByText("State of CSS 2024")).toBeVisible()

  // A real mutation through the real create flow.
  await page.getByRole("button", { name: "Folder actions" }).first().click()
  await page.getByRole("menuitem", { name: "New Bookmark" }).click()
  await page.locator("#bookmark-organizer-create-title").fill("Persisted Work")
  await page
    .locator("#bookmark-organizer-create-url")
    .fill("https://persisted.example")
  await page.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page.getByText("Persisted Work")).toBeVisible()

  // Reload: the same scenario world comes back — active source and all.
  await page.reload()
  await expect(tabs.filter({ hasText: "archive" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByText("Persisted Work")).toBeVisible()

  // Reset Scenario: deterministic seed, default active source.
  await page.getByRole("button", { name: "Open Dev Workbench" }).click()
  await page.getByRole("button", { name: "Reset scenario" }).click()
  await page.waitForURL(/\/\?scenario=browser-daemon$/)

  await expect(tabs.filter({ hasText: "Browser bookmarks" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByText("Persisted Work")).toHaveCount(0)
  await expect(page.getByText("MDN Web Docs")).toBeVisible()

  for (const title of [
    "Bookmarks Bar",
    "Social",
    "Productivity",
    "Email",
    "Travel",
    "Gaming",
  ]) {
    await expect(
      page
        .getByTestId("bookmark-card")
        .filter({ hasText: title })
        .first()
        .locator("div.grid")
    ).toBeVisible()
  }

  // The reset Vault is its seed again, too.
  await tabs.filter({ hasText: "archive" }).click()
  await expect(page.getByText("State of CSS 2024")).toBeVisible()
  await expect(page.getByText("Persisted Work")).toHaveCount(0)
})

test("scenario selection is stable through URL navigation", async ({
  page,
}) => {
  await page.goto("/?scenario=safari")
  const badge = page.getByRole("button", { name: /Source is healthy.*reading/ })
  await expect(badge).toBeVisible()

  // A plain reload of the same URL is the same world.
  await page.reload()
  await expect(badge).toBeVisible()

  // Navigating without the parameter keeps the persisted scenario.
  await page.goto("/")
  await expect(badge).toBeVisible()
})
