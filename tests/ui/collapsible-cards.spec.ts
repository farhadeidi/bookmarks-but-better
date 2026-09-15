import { expect, test } from "@playwright/test"

/**
 * A dashboard folder card collapsed to its header stays that way: the state
 * is a source-scoped preference, so it has to come back after a reload.
 */

test("a collapsed card stays collapsed after a reload", async ({ page }) => {
  await page.goto("/")

  const card = page
    .getByTestId("bookmark-card")
    .filter({ has: page.getByRole("heading", { name: "Social", exact: true }) })
  await expect(card.locator("a").first()).toBeVisible()

  await card.getByRole("button", { name: "Collapse folder" }).first().click()

  const expand = card.getByRole("button", { name: "Expand folder" }).first()
  await expect(expand).toHaveAttribute("aria-expanded", "false")
  await expect(card.locator("a")).toHaveCount(0)
  await expect(card.getByText(/^\d+ bookmarks?$/)).toBeVisible()

  await page.reload()

  await expect(expand).toBeVisible()
  await expect(expand).toHaveAttribute("aria-expanded", "false")
  await expect(card.locator("a")).toHaveCount(0)

  // Open again from the keyboard, so the reload is not simply showing an empty
  // card. The masonry re-deals as the card grows, and the focus has to stay on
  // its heading through that.
  const heading = card.getByRole("heading", { name: "Social", exact: true })
  await heading.focus()
  await page.keyboard.press("Enter")
  await expect(card.locator("a").first()).toBeVisible()
  await expect(heading).toBeFocused()
})
