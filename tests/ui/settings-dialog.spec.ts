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

test("appearance controls and product information remain available in Settings", async ({
  page,
}) => {
  const dialog = await openSettings(page)

  await dialog.getByRole("tab", { name: "Appearance" }).click()
  await expect(dialog.getByText("Light / dark", { exact: true })).toBeVisible()
  await expect(dialog.getByText("Color theme", { exact: true })).toBeVisible()

  await dialog.getByRole("tab", { name: "About" }).click()
  await expect(
    dialog.getByText("Bookmarks — But Better", { exact: true })
  ).toBeVisible()
  await expect(dialog.getByRole("link", { name: "GitHub" })).toBeVisible()
})

test("a source can be given a profile-local display label", async ({
  page,
}) => {
  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Sources" }).click()

  await dialog.getByRole("button", { name: "Rename reading" }).click()
  const labelInput = dialog.getByRole("textbox", { name: "Display label" })
  await labelInput.fill("Research")
  await dialog.getByRole("button", { name: "Save label" }).click()

  await expect(dialog.getByText("Research", { exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "Close" }).click()
  await expect(
    page.getByRole("tab", { name: "Research", exact: true })
  ).toBeVisible()
})

test("each daemon connection exposes its discovered Vaults and refresh control", async ({
  page,
}) => {
  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Sources" }).click()

  const daemon = dialog.getByRole("group", {
    name: "Daemon http://127.0.0.1:52222",
  })
  await expect(daemon.getByText("2 Vaults", { exact: true })).toBeVisible()
  await expect(daemon.getByText("reading", { exact: true })).toBeVisible()
  await expect(daemon.getByText("archive", { exact: true })).toBeVisible()
  await expect(
    daemon.getByRole("button", { name: "Refresh Vaults" })
  ).toBeVisible()
  await expect(daemon).toContainText(
    "Add, remove, or rename Vaults in the daemon configuration"
  )
})
