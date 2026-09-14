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

  const trigger = page.getByRole("button", { name: "Bookmark source" })
  await expect(trigger).toContainText("Browser bookmarks")

  await trigger.click()
  const items = page.getByRole("menuitem")
  await expect(items).toHaveCount(3)
  await expect(items.filter({ hasText: "Browser bookmarks" })).toHaveAttribute(
    "aria-disabled",
    "true"
  )
  await expect(items.filter({ hasText: "reading" })).toBeVisible()
  await expect(items.filter({ hasText: "archive" })).toBeVisible()
  await page.keyboard.press("Escape")

  // The Browser source is active and shows its seeded bookmarks.
  await expect(page.getByText("MDN Web Docs")).toBeVisible()
  await expect(page.getByText("Hacker News")).toBeVisible()
})

test("the Dev Workbench exercises real favicon URLs instead of forcing every bookmark to a letter fallback", async ({
  page,
}) => {
  await page.goto("/")

  const faviconImages = page
    .getByTestId("bookmark-card")
    .locator("img[src*='favicon']")
  await expect(faviconImages.first()).toBeVisible()
  expect(await faviconImages.count()).toBeGreaterThan(0)
  await expect(page.locator("img[src='']")).toHaveCount(0)
})

test("the filter bar has breathing room above the bookmark grid", async ({
  page,
}) => {
  await page.goto("/")
  await page.evaluate(() => document.documentElement.classList.add("dark"))

  const trigger = page.getByRole("button", { name: "Bookmark source" })
  const firstCard = page.getByTestId("bookmark-card").first()
  const [triggerBox, cardBox] = await Promise.all([
    trigger.boundingBox(),
    firstCard.boundingBox(),
  ])

  expect(triggerBox).not.toBeNull()
  expect(cardBox).not.toBeNull()
  expect(
    cardBox!.y - (triggerBox!.y + triggerBox!.height)
  ).toBeGreaterThanOrEqual(16)
})

test("bookmark cards fill the available content width on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")

  const card = page.getByTestId("bookmark-card").first()
  await expect(card).toBeVisible()
  const box = await card.boundingBox()

  expect(box).not.toBeNull()
  expect(box!.x).toBeLessThanOrEqual(17)
  expect(box!.width).toBeGreaterThanOrEqual(357)
})

test("mobile source and action controls stay contained without overlapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto("/")

  const trigger = page.getByRole("button", { name: "Bookmark source" })
  const toolbar = page.getByRole("toolbar", { name: "App actions" })
  const workbench = page.getByRole("button", { name: "Open Dev Workbench" })
  await expect(trigger).toBeVisible()
  await expect(toolbar).toBeVisible()
  await expect(workbench).toBeVisible()
  await expect(toolbar.getByRole("button")).toHaveCount(3)
  await expect(
    toolbar.getByRole("button", { name: "Search bookmarks" })
  ).toBeVisible()
  await expect(
    toolbar.getByRole("button", { name: "Bookmark tree" })
  ).toBeVisible()
  await expect(toolbar.getByRole("button", { name: "Settings" })).toBeVisible()

  const [triggerBox, toolbarBox, workbenchBox, firstActionBox] =
    await Promise.all([
      trigger.boundingBox(),
      toolbar.boundingBox(),
      workbench.boundingBox(),
      toolbar.getByRole("button").first().boundingBox(),
    ])

  for (const box of [triggerBox, toolbarBox]) {
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(15)
    expect(box!.x + box!.width).toBeLessThanOrEqual(305)
  }
  expect(firstActionBox?.height).toBeGreaterThanOrEqual(48)
  expect(workbenchBox!.y + workbenchBox!.height).toBeLessThanOrEqual(
    toolbarBox!.y - 8
  )
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
