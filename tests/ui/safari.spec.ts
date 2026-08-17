import { expect, test } from "@playwright/test"

/**
 * The Safari capability behavior: Safari's world has no Browser Source, so
 * the dashboard's only path in is a daemon Vault — one source means the
 * name-and-health badge rather than a tab switcher, and the daemon-only
 * empty state says so rather than guessing when nothing is connected.
 */

test("the safari scenario is daemon-only: no Browser Source exists", async ({
  page,
}) => {
  await page.goto("/?scenario=safari")

  // Exactly one enabled source: the compact badge, not a tab switcher.
  await expect(page.getByRole("tablist")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: /Source is healthy.*reading/ })
  ).toBeVisible()

  // The Vault's bookmarks load through the daemon-shaped adapter.
  await expect(page.getByText("SQLite is not a toy database")).toBeVisible()
})

test("a profile with nothing connected shows the daemon-only empty state", async ({
  page,
}) => {
  await page.goto("/?scenario=empty")

  await expect(page.getByText("No bookmark source yet.")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Connect a daemon" })
  ).toBeVisible()
  await expect(page.getByRole("tab")).toHaveCount(0)
})

test("the fresh-chrome scenario still has onboarding to do", async ({
  page,
}) => {
  await page.goto("/?scenario=fresh-chrome")

  // The wizard owns the dashboard until setup is completed.
  await expect(
    page.getByRole("heading", { level: 2, name: "Bookmarks — But Better" })
  ).toBeVisible()
})
