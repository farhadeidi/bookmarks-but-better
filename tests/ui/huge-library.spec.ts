import { expect, test } from "@playwright/test"

/**
 * A collection of ten thousand bookmarks (issue #75).
 *
 * The grid lays out every folder card but only mounts the ones near the
 * viewport; the rest are placeholders of the same height. These cases pin
 * the two things that make that safe to rely on: scrolling brings cards in
 * and tears them down again, and the keyboard can still reach an item whose
 * card is not mounted yet.
 */

const CARD = '[data-testid="bookmark-card"]'
const PLACEHOLDER = '[data-testid="bookmark-card-placeholder"]'
const SCROLL_VIEWPORT = '[data-slot="scroll-area-viewport"]'

test("only the cards near the viewport are mounted", async ({ page }) => {
  await page.goto("/?scenario=huge-library")
  await page.waitForSelector(CARD)

  const mounted = await page.locator(CARD).count()
  const placeholders = await page.locator(PLACEHOLDER).count()
  expect(mounted).toBeGreaterThan(0)
  expect(placeholders).toBeGreaterThan(mounted * 5)

  // Well under the collection size: this is the whole point.
  expect(await page.locator("a[href]").count()).toBeLessThan(1500)
})

test("scrolling mounts cards further down and tears down the ones left behind", async ({
  page,
}) => {
  await page.goto("/?scenario=huge-library")
  await page.waitForSelector(CARD)

  // The second card, not the first: the first holds the grid's initial tab
  // stop, which pins it mounted wherever the page is scrolled to.
  const title = await page.locator(`${CARD} > div > h3`).nth(1).textContent()

  await page.locator(SCROLL_VIEWPORT).evaluate((viewport) => {
    viewport.scrollTop = viewport.scrollHeight
  })

  await expect(page.locator(PLACEHOLDER, { hasText: title ?? "" })).toHaveCount(
    1
  )
  await expect(page.locator(CARD, { hasText: title ?? "" })).toHaveCount(0)
  expect(await page.locator(CARD).count()).toBeGreaterThan(0)
})

test("End reaches the last item of the column even before its card exists", async ({
  page,
}) => {
  await page.goto("/?scenario=huge-library")
  await page.waitForSelector(CARD)
  const start = await page.evaluate(() => {
    const stop = document.querySelector(
      '[data-testid="bookmark-card"] h3[tabindex="0"]'
    ) as HTMLElement | null
    stop?.focus()
    return stop?.textContent
  })

  await page.keyboard.press("End")

  const focused = page.locator(":focus")
  await expect(focused).toHaveAttribute("tabindex", "0")
  await expect(focused).not.toHaveText(start ?? "")
  await expect(focused).toBeInViewport()
  // The card the key landed in stays mounted while it holds the tab stop.
  await expect(
    focused.locator(`xpath=ancestor::*[@data-testid="bookmark-card"]`)
  ).toHaveCount(1)
})
