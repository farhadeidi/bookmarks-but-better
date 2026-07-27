import { expect, test } from "@playwright/test"

test("renders the real daemon vault", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  await page.goto("http://127.0.0.1:47321")

  await expect(page.getByText("Development", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Rust External Edit", { exact: true })
  ).toBeVisible()
  await expect(page.getByText("Daemon unavailable")).toHaveCount(0)
  expect(errors).toEqual([])
})
