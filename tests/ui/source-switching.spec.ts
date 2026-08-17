import { expect, test } from "@playwright/test"

/**
 * Source switching: every tab is a Source Session transition against a
 * different simulated source, using exactly the interfaces production uses.
 */

test("switching between the browser source and daemon vaults", async ({
  page,
}) => {
  await page.goto("/")

  const tabs = page
    .getByRole("tablist", { name: "Bookmark source" })
    .getByRole("tab")

  // Browser → reading: the session re-initializes against the Vault's tree.
  await tabs.filter({ hasText: "reading" }).click()
  await expect(tabs.filter({ hasText: "reading" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByText("SQLite is not a toy database")).toBeVisible()

  // reading → archive: a different Vault of the same daemon, kept apart.
  await tabs.filter({ hasText: "archive" }).click()
  await expect(page.getByText("State of CSS 2024")).toBeVisible()
  await expect(page.getByText("SQLite is not a toy database")).toHaveCount(0)

  // And back to the browser source.
  await tabs.filter({ hasText: "Browser bookmarks" }).click()
  await expect(page.getByText("MDN Web Docs")).toBeVisible()
})

test("the multi-vault scenario hosts four switchable vaults", async ({
  page,
}) => {
  await page.goto("/?scenario=multi-vault")

  const tabs = page
    .getByRole("tablist", { name: "Bookmark source" })
    .getByRole("tab")
  await expect(tabs).toHaveCount(4)
  await expect(tabs.filter({ hasText: "reading" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  // No Browser Source in this scenario at all.
  await expect(tabs.filter({ hasText: "Browser bookmarks" })).toHaveCount(0)

  await tabs.filter({ hasText: "research" }).click()
  await expect(page.getByText("CRDTs: The Hard Parts")).toBeVisible()
})
