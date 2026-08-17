import { expect, test } from "@playwright/test"

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/?scenario=browser-daemon")
  await page.evaluate(() => document.documentElement.classList.add("dark"))
  await page.getByRole("button", { name: "Settings" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(150)
  return dialog
}

test("the Settings shell is visually distinct and stays the same size across categories", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  const dialog = await openSettings(page)
  await expect(dialog).toBeVisible()

  const initialBox = await dialog.boundingBox()
  expect(initialBox).not.toBeNull()

  const [pageBackground, dialogBackground] = await Promise.all([
    page
      .locator("body")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    dialog.evaluate((node) => getComputedStyle(node).backgroundColor),
  ])
  expect(dialogBackground).not.toBe(pageBackground)

  for (const category of [
    "Sources",
    "Appearance",
    "Data & Migration",
    "Advanced",
    "About",
    "General",
  ]) {
    await test.step(category, async () => {
      await dialog.getByRole("tab", { name: category }).click()
      await expect(dialog).toBeVisible()
      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      expect(Math.abs(box!.height - initialBox!.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(box!.width - initialBox!.width)).toBeLessThanOrEqual(1)
    })
  }
})

test("Browser bookmark settings live inside Sources instead of a separate category", async ({
  page,
}) => {
  await openSettings(page)

  await expect(page.getByRole("tab", { name: "Bookmarks" })).toHaveCount(0)
  await page.getByRole("tab", { name: "Sources" }).click()
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByText("Browser bookmarks", { exact: true })
  ).toBeVisible()
  await expect(dialog.getByText("Root folder", { exact: true })).toBeVisible()
  await expect(
    dialog.getByText("Nested folders", { exact: true })
  ).toBeVisible()
})
