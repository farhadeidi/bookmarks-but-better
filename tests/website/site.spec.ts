import { test, expect } from "@playwright/test"

test.describe("marketing website artifact", () => {
  test("serves every public page at its clean URL", async ({ page }) => {
    const pages = [
      ["/", "Bookmarks But Better — Your bookmarks, beautiful. Every new tab."],
      ["/privacy/", "Privacy — Bookmarks But Better"],
      ["/daemon/", "Vault daemon — Bookmarks But Better"],
      ["/preview/", "Live preview — Bookmarks But Better"],
    ] as const

    for (const [path, title] of pages) {
      await page.goto(path)
      await expect(page).toHaveTitle(title)
      await expect(page.locator("h1")).toBeVisible()
    }
  })

  test("keeps the marketing preview separate from the embedded app", async ({
    page,
  }) => {
    await page.goto("/preview/")
    await expect(page).toHaveTitle("Live preview — Bookmarks But Better")
    await expect(page.locator("iframe")).toHaveAttribute(
      "src",
      /\/app-preview\//
    )

    const appFrame = page.frameLocator("iframe")
    await expect(appFrame.getByRole("tab", { name: "archive" })).toBeVisible()
    await expect(
      appFrame.getByRole("button", { name: "Settings" })
    ).toBeVisible()
    const faviconImages = appFrame.locator("img[src*='favicon']")
    await expect(faviconImages.first()).toBeVisible()
    expect(await faviconImages.count()).toBeGreaterThan(0)
  })

  test("has no horizontal overflow on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")

    await expect(
      page.getByRole("heading", { name: "Bookmarks, but better" })
    ).toBeVisible()
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true)

    const appFrame = page
      .frames()
      .find((frame) => frame.url().includes("/app-preview/"))
    expect(appFrame).toBeDefined()
    expect(
      await appFrame?.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true)
  })
})
