import { expect, test, type Page } from "@playwright/test"

/**
 * Source switching: picking a source from the menu is a Source Session
 * transition against a different simulated source, using exactly the
 * interfaces production uses.
 */

/** Opens the source switcher's menu and picks the source named `label`. */
async function switchSource(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Bookmark source" }).click()
  await page.getByRole("menuitem", { name: label }).click()
}

test("switching between the browser source and daemon vaults", async ({
  page,
}) => {
  await page.goto("/")

  const trigger = page.getByRole("button", { name: "Bookmark source" })

  // Browser → reading: the session re-initializes against the Vault's tree.
  await switchSource(page, "reading")
  await expect(trigger).toContainText("reading")
  await expect(page.getByText("SQLite is not a toy database")).toBeVisible()

  // reading → archive: a different Vault of the same daemon, kept apart.
  await switchSource(page, "archive")
  await expect(page.getByText("State of CSS 2024")).toBeVisible()
  await expect(page.getByText("SQLite is not a toy database")).toHaveCount(0)

  // And back to the browser source.
  await switchSource(page, "Browser bookmarks")
  await expect(page.getByText("MDN Web Docs")).toBeVisible()
})

test("the multi-vault scenario hosts four switchable vaults", async ({
  page,
}) => {
  await page.goto("/?scenario=multi-vault")

  const trigger = page.getByRole("button", { name: "Bookmark source" })
  await expect(trigger).toContainText("reading")

  await trigger.click()
  const items = page
    .getByRole("menuitem")
    .filter({ hasNotText: "Manage sources" })
  await expect(items).toHaveCount(4)
  // No Browser Source in this scenario at all.
  await expect(items.filter({ hasText: "Browser bookmarks" })).toHaveCount(0)
  await items.filter({ hasText: "research" }).click()

  await expect(page.getByText("CRDTs: The Hard Parts")).toBeVisible()
})
