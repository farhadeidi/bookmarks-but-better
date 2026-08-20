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

test("a fresh Safari profile is onboarded straight into connecting a daemon", async ({
  page,
}) => {
  await page.goto("/?scenario=fresh-safari")

  // No welcome screen and no source question: there is only one source here,
  // so the wizard opens on setting it up — and says what Safari does and does
  // not do.
  await expect(page.getByText("Where do your bookmarks live?")).toHaveCount(0)
  await expect(
    page.getByRole("heading", { level: 2, name: "Set up the daemon" })
  ).toBeVisible()
  await expect(
    page.getByText(/does not share its own bookmarks with extensions/)
  ).toBeVisible()
  await expect(page.getByText(/iCloud Drive/)).toBeVisible()
})

/**
 * The last step is a capability-driven card, so what it says is the only
 * honest test of the capability seam reaching it — see ADR 0004.
 */
test("the wizard's last step teaches Safari nothing Safari does not have", async ({
  page,
}) => {
  await page.goto("/?scenario=fresh-safari")

  await expect(
    page.getByRole("heading", { level: 2, name: "You're all set" })
  ).toBeVisible()
  // Type-to-search exists everywhere the dashboard does.
  await expect(
    page.getByText(/first character you type opens search/)
  ).toBeVisible()
  // Safari overrides no new tab page and has no omnibox.
  await expect(page.getByText(/new tab/i)).toHaveCount(0)
  await expect(page.getByText("bb", { exact: true })).toHaveCount(0)
})

test("the fresh-chrome scenario opens on the source question and teaches the keyword", async ({
  page,
}) => {
  await page.goto("/?scenario=fresh-chrome")

  // The wizard owns the dashboard until setup is completed, and its first
  // step is a real question rather than a logo.
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Where do your bookmarks live?",
    })
  ).toBeVisible()

  // Chrome replaces the new tab page and has an omnibox, so the card says so.
  await expect(page.getByText(/Every new tab is this dashboard/)).toBeVisible()
  await expect(page.getByText("bb", { exact: true })).toHaveCount(1)
})
