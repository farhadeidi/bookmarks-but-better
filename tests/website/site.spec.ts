import { expect, test, type FrameLocator, type Page } from "@playwright/test"

const SITE = "https://bookmarks.but-better.dev"

const PAGES = [
  {
    path: "/",
    title: "Bookmarks But Better — Your bookmarks as a beautiful new tab",
    h1: "Bookmarks, but better",
  },
  {
    path: "/privacy/",
    title: "Privacy — Bookmarks But Better",
    h1: "Privacy",
  },
  {
    path: "/guides/",
    title: "Guides — Bookmarks But Better",
    h1: "Guides",
  },
  {
    path: "/docs/",
    title: "Documentation — Bookmarks But Better",
    h1: "Documentation",
  },
  {
    path: "/docs/daemon/",
    title: "Markdown vaults — Bookmarks But Better",
    h1: "Markdown vaults",
  },
] as const

const MAIN_NAV = ["/preview/", "/docs/", "/privacy/", "/docs/start/install/"]

/** The text of every <h1> in raw HTML, tags stripped and whitespace collapsed. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/g)].map(([h1]) =>
    h1
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/ ,/g, ",")
      .trim()
  )
}

async function expectLiveApp(page: Page, app: Page | FrameLocator) {
  await app.getByRole("button", { name: "Bookmark source" }).click()
  await expect(app.getByRole("menuitem", { name: "archive" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(app.getByRole("button", { name: "Settings" })).toBeVisible()

  const favicons = app.locator("img[src*='favicon']")
  await expect(favicons.first()).toBeVisible()
  expect(await favicons.count()).toBeGreaterThan(0)

  for (const title of [
    "Bookmarks Bar",
    "Social",
    "Productivity",
    "Email",
    "Travel",
    "Gaming",
  ]) {
    await expect(
      app
        .getByTestId("bookmark-card")
        .filter({ hasText: title })
        .first()
        .locator("div.grid")
    ).toBeVisible()
  }
}

async function hasNoHorizontalOverflow(target: Page | FrameLocator) {
  const root = target.locator("html")
  return root.evaluate((element) => element.scrollWidth <= element.clientWidth)
}

test.describe("marketing website artifact", () => {
  test("serves every public page with its title and one h1", async ({
    page,
  }) => {
    for (const { path, title, h1 } of PAGES) {
      await page.goto(path)
      await expect(page).toHaveTitle(title)
      await expect(page.locator("h1")).toHaveCount(1)
      await expect(page.locator("h1")).toHaveText(h1)
    }
  })

  test("renders headings and navigation without JavaScript", async ({
    request,
  }) => {
    for (const { path, h1 } of PAGES) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(200)
      const html = await response.text()

      expect(headings(html), path).toEqual([h1])
      expect(html, path).toContain(
        `<link rel="canonical" href="${SITE}${path}"`
      )
      expect(html, path).toContain(`content="${SITE}/og.png"`)

      // The site and the docs share the same header links, and the docs'
      // header leads back to the main site.
      expect(html, path).toContain('href="/"')
      for (const href of MAIN_NAV) {
        expect(html, `${path} links ${href}`).toContain(`href="${href}"`)
      }
      if (!path.startsWith("/docs/")) {
        // Header links are pages, never sections of the home page.
        expect(html, path).not.toMatch(
          /<nav[^>]*aria-label="Main"[\s\S]*?href="\/#/
        )
      }
    }
  })

  test("redirects the retired daemon page to the docs", async ({ page }) => {
    await page.goto("/daemon/")
    await expect(page).toHaveURL(/\/docs\/daemon\/$/)
    await expect(page.locator("h1")).toHaveText("Markdown vaults")
  })

  test("hero shows a screenshot and loads the live app only on request", async ({
    page,
  }) => {
    const appRequests: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/preview/")) {
        appRequests.push(request.url())
      }
    })

    await page.goto("/")
    const demo = page.locator("#demo")
    const screenshot = demo.locator("picture img")
    await expect(screenshot).toBeVisible()
    await expect(screenshot).toHaveAttribute("fetchpriority", "high")
    await expect(demo.locator("iframe")).toHaveCount(0)
    await page.waitForLoadState("load")
    expect(appRequests).toEqual([])

    await demo.getByRole("button", { name: "Try it live" }).click()
    await expect(demo.locator("iframe")).toHaveAttribute("src", /\/preview\//)
    await expectLiveApp(page, page.frameLocator("#demo iframe"))
  })

  test("the preview page is the live app alone, full screen", async ({
    page,
  }) => {
    await page.goto("/preview/")
    await expect(page).toHaveTitle("Live preview — Bookmarks But Better")
    await expect(page.locator("header nav")).toHaveCount(0)
    await expect(page.locator("iframe")).toHaveCount(0)
    await expectLiveApp(page, page)
  })

  test("docs render and Pagefind search finds a docs page", async ({
    page,
  }) => {
    await page.goto("/docs/")
    await expect(page.locator("h1")).toHaveText("Documentation")

    await page.locator("button[data-open-modal]").click()
    const dialog = page.getByRole("dialog", { name: "Search" })
    await dialog.getByRole("textbox", { name: "Search" }).fill("vault")
    await expect(dialog.locator(".pagefind-ui__result").first()).toBeVisible()
  })

  test("publishes a sitemap, robots.txt and llms.txt", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text()
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap-index.xml`)

    const index = await (await request.get("/sitemap-index.xml")).text()
    const sitemaps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      ([, loc]) => new URL(loc).pathname
    )
    expect(sitemaps.length).toBeGreaterThan(0)
    const urls = (
      await Promise.all(
        sitemaps.map(async (path) => (await request.get(path)).text())
      )
    ).join("\n")
    expect(urls).toContain(`<loc>${SITE}/docs/</loc>`)
    expect(urls).toContain(`<loc>${SITE}/docs/daemon/</loc>`)
    expect(urls).toContain(`<loc>${SITE}/guides/</loc>`)
    expect(urls).not.toContain(`<loc>${SITE}/preview/</loc>`)
    expect(urls).not.toContain(`<loc>${SITE}/daemon/</loc>`)

    const llms = await (await request.get("/llms.txt")).text()
    expect(llms).toContain(`(${SITE}/docs/)`)
    expect(llms).toContain(`(${SITE}/docs/daemon/)`)
    expect(llms).not.toContain(`(${SITE}/daemon/)`)
    expect(llms).toContain("## Product constraints")
  })

  test("serves the custom 404 page for unknown URLs", async ({ page }) => {
    for (const path of ["/no-such-page/", "/docs/no-such-page/"]) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(404)
      await expect(page.locator("h1")).toHaveText("Nothing here.")
    }
  })

  test("has no horizontal overflow on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    for (const path of ["/", "/docs/", "/guides/"]) {
      await page.goto(path)
      expect(await hasNoHorizontalOverflow(page), path).toBe(true)
    }

    await page.goto("/")
    await page.getByRole("button", { name: "Try it live" }).click()
    const app = page.frameLocator("#demo iframe")
    await expect(app.getByRole("button", { name: "Settings" })).toBeVisible()
    expect(await hasNoHorizontalOverflow(app)).toBe(true)
  })
})
