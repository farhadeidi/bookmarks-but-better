import { expect, test } from "@playwright/test"

/**
 * The offline path and its recovery: the daemon-offline scenario starts with
 * the simulated daemon down, the dashboard reports the source as unavailable
 * (never falling back), and bringing the daemon back plus Retry recovers —
 * all through the application's real error handling.
 */

test("an offline daemon surfaces the unavailable state and recovers via Retry", async ({
  page,
}) => {
  await page.goto("/?scenario=daemon-offline")

  // The browser source still works.
  await expect(page.getByText("MDN Web Docs")).toBeVisible()

  const tabs = page
    .getByRole("tablist", { name: "Bookmark source" })
    .getByRole("tab")
  await tabs.filter({ hasText: "reading" }).click()

  // Unavailable — with the source kept selected, no silent fallback.
  const alert = page.getByRole("alert")
  await expect(alert).toContainText("Bookmarks are unavailable")
  await expect(tabs.filter({ hasText: "reading" })).toHaveAttribute(
    "aria-selected",
    "true"
  )

  // Bring the simulated daemon back through the workbench control.
  await page.getByRole("button", { name: "Open Dev Workbench" }).click()
  const online = page.getByRole("switch", { name: /Daemon online/ })
  await expect(online).toHaveAttribute("aria-checked", "false")
  await online.click()
  await expect(online).toHaveAttribute("aria-checked", "true")

  // Retry loads the Vault.
  await page.getByRole("button", { name: "Retry" }).click()
  await expect(page.getByText("SQLite is not a toy database")).toBeVisible()

  // The recovered session must still be subscribed to the adapter's
  // events: the very next mutation renders only because its created event
  // refreshes the tree. (Init failed once — a session that skipped event
  // subscription on that failure would pass the Retry assertion above and
  // then silently never render a change again.)
  await page.getByRole("button", { name: "Folder actions" }).first().click()
  await page.getByRole("menuitem", { name: "New Bookmark" }).click()
  await page.locator("#bookmark-organizer-create-title").fill("After Recovery")
  await page
    .locator("#bookmark-organizer-create-url")
    .fill("https://recovered.example")
  await page.getByRole("button", { name: "Create", exact: true }).click()

  await expect(page.getByText("After Recovery")).toBeVisible()
})

test("the mutation-failure control exercises the daemon's refusal path", async ({
  page,
}) => {
  await page.goto("/?scenario=browser-daemon")

  const tabs = page
    .getByRole("tablist", { name: "Bookmark source" })
    .getByRole("tab")
  await tabs.filter({ hasText: "archive" }).click()
  await expect(page.getByText("State of CSS 2024")).toBeVisible()

  await page.getByRole("button", { name: "Open Dev Workbench" }).click()
  await page.getByRole("switch", { name: /Mutation failure/ }).click()

  // Creating inside a folder is refused, and the failure surfaces.
  await page.getByRole("button", { name: "Folder actions" }).first().click()
  await page.getByRole("menuitem", { name: "New Bookmark" }).click()
  await page
    .locator("#bookmark-organizer-create-title")
    .fill("Should Not Persist")
  await page
    .locator("#bookmark-organizer-create-url")
    .fill("https://no.example")
  await page.getByRole("button", { name: "Create", exact: true }).click()

  await expect(page.getByText(/Simulated mutation failure/)).toBeVisible()
  await expect(page.getByText("Should Not Persist")).toHaveCount(0)
})
