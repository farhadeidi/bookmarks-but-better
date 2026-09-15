import { expect, test, type FrameLocator, type Page } from "@playwright/test"

const SITE = "https://bookmarks.but-better.dev"

const PAGES = [
  {
    path: "/",
    title: "Bookmarks But Better — Your bookmarks as a beautiful new tab",
    h1: "Bookmarks, but better",
  },
  {
    path: "/preview/",
    title: "Live preview — Bookmarks But Better",
    h1: "Live preview",
  },
  {
    path: "/privacy/",
    title: "Privacy — Bookmarks But Better",
    h1: "Privacy",
  },
  {
    path: "/docs/guides/",
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

const MAIN_NAV = ["/preview/", "/docs/", "/docs/guides/", "/privacy/"]

/** Every section link, in header order. */
const NAV_LABELS = ["Home", "Demo", "Docs", "Guides", "Privacy"]

/** The app's frame on the preview page. */
const APP_FRAME = "[data-preview-stage] iframe"

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

      // One header everywhere: Starlight's, with the same links on the
      // marketing pages and the docs.
      expect(html.match(/<header[^>]*class="header\b/g), path).toHaveLength(1)
      expect(html, path).toContain('href="/"')
      for (const href of MAIN_NAV) {
        expect(html, `${path} links ${href}`).toContain(`href="${href}"`)
      }
    }
  })

  test("marketing pages open the site links from the mobile menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    await page.getByRole("button", { name: "Menu" }).click()
    const menu = page.getByRole("navigation", { name: "Site" })
    for (const label of NAV_LABELS) {
      await expect(menu.getByRole("link", { name: label })).toBeVisible()
    }
    await menu.getByRole("link", { name: "Demo" }).click()
    await expect(page).toHaveURL(/\/preview\/$/)
  })

  test("the header row collapses into one menu, never two", async ({
    page,
  }) => {
    // The header's own menu button, and Starlight's sidebar toggle on docs.
    const own = page.locator(".bbb-header .menu-button")
    const starlight = page.locator(".sl-menu-button")
    const row = page.locator(".bbb-header .links")

    for (const [width, path, expected] of [
      // Docs under 50rem: Starlight's toggle, whose menu lists the same links.
      [390, "/docs/", "starlight"],
      [768, "/docs/", "starlight"],
      // The band: the sidebar is permanent, so its toggle is gone and the
      // header's own menu takes over.
      [820, "/docs/", "own"],
      [1024, "/docs/", "own"],
      // Marketing pages have no sidebar toggle at any width.
      [390, "/", "own"],
      [820, "/", "own"],
      [1024, "/", "own"],
      // At the breakpoint the whole row is back and no menu button shows.
      [1100, "/", "row"],
      [1100, "/docs/", "row"],
      [1440, "/docs/", "row"],
    ] as const) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      const where = `${path} @${width}`
      await expect(own, where).toBeVisible({ visible: expected === "own" })
      await expect(starlight, where).toBeVisible({
        visible: expected === "starlight",
      })
      await expect(row, where).toBeVisible({ visible: expected === "row" })
    }
  })

  test("the header's menu carries every link, marked, in the band", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 820, height: 900 })
    for (const path of ["/", "/docs/"]) {
      await page.goto(path)
      // The install button stays in the row, so the header still leads
      // somewhere with the links away.
      await expect(
        page.locator(".bbb-header .cta a:visible"),
        path
      ).toHaveCount(1)

      await page.getByRole("button", { name: "Menu" }).click()
      const menu = page.getByRole("navigation", { name: "Site" })
      for (const label of NAV_LABELS) {
        await expect(
          menu.getByRole("link", { name: label }),
          path
        ).toBeVisible()
      }
    }
    // The current section is still marked inside the menu.
    await expect(
      page
        .getByRole("navigation", { name: "Site" })
        .getByRole("link", { name: "Docs" })
    ).toHaveAttribute("aria-current", "page")
  })

  test("redirects the retired daemon page to the docs", async ({ page }) => {
    await page.goto("/daemon/")
    await expect(page).toHaveURL(/\/docs\/daemon\/$/)
    await expect(page.locator("h1")).toHaveText("Markdown vaults")
  })

  test("hero shows a screenshot and links to the preview page", async ({
    page,
  }) => {
    const appRequests: string[] = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/preview/app/")) {
        appRequests.push(request.url())
      }
    })

    await page.goto("/")
    const demo = page.locator("#demo")
    // Light and dark versions both render; the site mode shows exactly one.
    const screenshot = demo.locator("picture img:visible")
    await expect(screenshot).toHaveCount(1)
    await expect(screenshot).toHaveAttribute("fetchpriority", "high")
    // The home page never embeds the app: it links to the page that runs it.
    await expect(demo.locator("iframe")).toHaveCount(0)
    await page.waitForLoadState("load")
    expect(appRequests).toEqual([])

    await demo.getByRole("link", { name: "Try it live" }).click()
    await expect(page).toHaveURL(/\/preview\/$/)
  })

  test("the preview page carries the site header and runs the live app", async ({
    page,
  }) => {
    await page.goto("/preview/")
    await expect(page).toHaveTitle("Live preview — Bookmarks But Better")

    // Not a dead end: the whole site header is here, marking the current page.
    const nav = page.getByRole("navigation", { name: "Site" }).first()
    await expect(nav.getByRole("link", { name: "Demo" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    await expect(nav.getByRole("link", { name: "Docs" })).toBeVisible()

    await expect(page.locator(APP_FRAME)).toHaveAttribute(
      "src",
      /\/preview\/app\//
    )
    await expectLiveApp(page, page.frameLocator(APP_FRAME))
  })

  test("the preview page's theme dots change the app and the URL", async ({
    page,
  }) => {
    await page.goto("/preview/")
    const app = page.frameLocator(APP_FRAME)
    await expect(app.getByRole("button", { name: "Settings" })).toBeVisible()

    // Every theme redefines the app's tokens, so one of them is enough to tell
    // that the frame really switched rather than only the dot lighting up.
    const primary = () =>
      app
        .locator("html")
        .evaluate((el) => getComputedStyle(el).getPropertyValue("--primary"))
    const before = await primary()

    const dot = page.getByRole("button", {
      name: "Preview the Cyberpunk theme",
    })
    await dot.click()
    await expect(dot).toHaveAttribute("aria-pressed", "true")
    await expect(page).toHaveURL(/\?theme=cyberpunk$/)
    await expect.poll(primary).not.toBe(before)
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
    expect(urls).toContain(`<loc>${SITE}/docs/guides/</loc>`)
    // A real page now, in the header and the footer, so it is listed. The bare
    // app it embeds is not a page and carries noindex.
    expect(urls).toContain(`<loc>${SITE}/preview/</loc>`)
    expect(urls).not.toContain(`<loc>${SITE}/daemon/</loc>`)

    const appFrame = await request.get("/preview/app/")
    expect(appFrame.status()).toBe(200)
    expect(await appFrame.text()).toContain('name="robots" content="noindex"')

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

    for (const path of ["/", "/docs/", "/docs/guides/", "/preview/"]) {
      await page.goto(path)
      expect(await hasNoHorizontalOverflow(page), path).toBe(true)
    }

    await page.goto("/preview/")
    const app = page.frameLocator(APP_FRAME)
    await expect(app.getByRole("button", { name: "Settings" })).toBeVisible()
    expect(await hasNoHorizontalOverflow(app)).toBe(true)
  })

  test("the preview page fills the viewport without a second scrollbar", async ({
    page,
  }) => {
    for (const width of [390, 820, 1440]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto("/preview/")
      const app = page.frameLocator(APP_FRAME)
      await expect(app.getByRole("button", { name: "Settings" })).toBeVisible()

      // The page itself never scrolls; the app inside it does.
      const scrolls = await page
        .locator("html")
        .evaluate((el) => el.scrollHeight > el.clientHeight)
      expect(scrolls, `page scrolls at ${width}`).toBe(false)

      // And the frame reaches the bottom of the viewport.
      const gap = await page
        .locator(APP_FRAME)
        .evaluate(
          (el) => window.innerHeight - el.getBoundingClientRect().bottom
        )
      expect(Math.abs(gap), `frame gap at ${width}`).toBeLessThanOrEqual(1)
    }
  })
})
