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

/** The structured data each kind of page carries, in document order. */
const STRUCTURED_DATA = [
  { path: "/", types: ["WebSite", "SoftwareApplication", "FAQPage"] },
  { path: "/preview/", types: [] },
  { path: "/privacy/", types: ["Article"] },
  { path: "/docs/", types: ["TechArticle"] },
  { path: "/docs/start/install/", types: ["TechArticle"] },
  { path: "/docs/guides/raindrop-alternative/", types: ["TechArticle"] },
] as const

/** Every user agent robots.txt names, each of which needs its own rules. */
const CRAWLERS = [
  "*",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
]

/** The H2 file lists in llms.txt, in order. */
const LLMS_SECTIONS = [
  "Pages",
  "Getting started",
  "Markdown vaults",
  "Guides",
  "Optional",
]

/**
 * The install buttons read `<html data-browser>`, which Head.astro sets from
 * the user agent before first paint, so the user agent is how the site's own
 * logic is driven. Chromium, and a visitor without JavaScript, keep the Chrome
 * default the other tests see.
 */
const BROWSER_CTAS = [
  {
    label: "Firefox",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    browser: "firefox",
    /** The header's one button. */
    header: "Add to Firefox",
    /** Every hero install button, left to right. */
    buttons: ["Add to Firefox", "Add to Chrome"],
    buildFromSource: false,
  },
  {
    label: "Safari",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    browser: "safari",
    header: "Safari: coming soon",
    buttons: ["Safari version coming soon", "Add to Chrome", "Add to Firefox"],
    buildFromSource: true,
  },
] as const

/** Every JSON-LD block in raw HTML, parsed. Throws on invalid JSON. */
function structuredData(html: string): Record<string, unknown>[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    ),
  ].map(([, json]) => JSON.parse(json) as Record<string, unknown>)
}

/** The node of a given type, failing where it is asked for if it is missing. */
function node(
  blocks: Record<string, unknown>[],
  type: string
): Record<string, unknown> {
  const found = blocks.find((block) => block["@type"] === type)
  expect(found, type).toBeDefined()
  return found ?? {}
}

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
    const menu = page.getByRole("navigation", { name: "Site menu" })
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
      const menu = page.getByRole("navigation", { name: "Site menu" })
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
        .getByRole("navigation", { name: "Site menu" })
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

  test("the hero screenshot shows the variant that matches the site mode", async ({
    page,
  }) => {
    await page.goto("/")

    // Both versions carry the hero's loading hints: either one can be the LCP
    // element, so marking only the light one would hand the high-priority slot
    // to an image a dark-mode visitor never sees.
    expect(
      await page
        .locator("#demo picture img")
        .evaluateAll((images) =>
          images.map((image) => [
            image.getAttribute("loading"),
            image.getAttribute("fetchpriority"),
          ])
        )
    ).toEqual([
      ["eager", "high"],
      ["eager", "high"],
    ])

    // Exactly one is displayed, and it is the file for the mode on screen:
    // counting visible images alone would pass if both slots showed the light
    // version.
    const shot = page.locator("#demo picture img:visible")
    await expect(shot).toHaveCount(1)
    await expect(shot).toHaveAttribute("src", /dashboard-light\./)

    await page.getByRole("button", { name: "Dark mode" }).click()
    await expect(shot).toHaveCount(1)
    await expect(shot).toHaveAttribute("src", /dashboard-dark\./)
  })

  for (const cta of BROWSER_CTAS) {
    test.describe(`a ${cta.label} visitor`, () => {
      test.use({ userAgent: cta.userAgent })

      test("gets install buttons that name their own browser", async ({
        page,
      }) => {
        await page.goto("/")
        await expect(page.locator("html")).toHaveAttribute(
          "data-browser",
          cta.browser
        )

        // The header's one button names the same browser, smaller.
        await expect(page.locator(".bbb-header .cta a:visible")).toHaveText(
          cta.header
        )

        // The hero's row, read left to right: the primary button leads it
        // whatever its place in the markup, which is what `order-first` does.
        const hero = page.locator("section:has(#hero-title)")
        const buttons = await hero
          .locator("a:visible")
          .filter({ hasText: /Add to |coming soon/ })
          .evaluateAll((links) =>
            links
              .map((link) => ({
                x: link.getBoundingClientRect().x,
                label: (link.textContent ?? "").replace(/\s+/g, " ").trim(),
              }))
              .sort((a, b) => a.x - b.x)
              .map((link) => link.label)
          )
        expect(buttons).toEqual([...cta.buttons])

        // Only Safari, whose version is not released yet, is offered the
        // source build.
        await expect(
          hero.getByRole("link", { name: "build it from source" })
        ).toBeVisible({ visible: cta.buildFromSource })
      })
    })
  }

  test("the preview page carries the site header and runs the live app", async ({
    page,
  }) => {
    await page.goto("/preview/")
    await expect(page).toHaveTitle("Live preview — Bookmarks But Better")

    // Not a dead end: the whole site header is here, marking the current page.
    // `exact`, because the collapsed menu is the "Site menu" landmark: the two
    // are named apart so a screen reader does not announce them identically.
    const nav = page.getByRole("navigation", { name: "Site", exact: true })
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

  test("the preview page's dots follow a theme chosen inside the app", async ({
    page,
  }) => {
    await page.goto("/preview/")
    const app = page.frameLocator(APP_FRAME)
    await expect(app.getByRole("button", { name: "Settings" })).toBeVisible()

    const dot = (theme: string) =>
      page.locator(`[data-preview-theme="${theme}"]`)

    // Nothing here asked for a theme — no `?theme=`, no dot clicked — so a
    // marked dot can only be the app reporting the one it settled on.
    await expect(dot("default")).toHaveAttribute("aria-pressed", "true")

    // Change it where a visitor would: the app's own appearance settings.
    await app.getByRole("button", { name: "Settings" }).click()
    await app.getByRole("tab", { name: "Appearance" }).click()
    await app.getByRole("radio", { name: "Cyberpunk" }).click()

    await expect(dot("cyberpunk")).toHaveAttribute("aria-pressed", "true")
    await expect(dot("default")).toHaveAttribute("aria-pressed", "false")
    // The dots followed the app rather than drove it, so the shareable
    // `?theme=` — which only a dot writes — is still absent.
    await expect(page).toHaveURL(/\/preview\/$/)
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

  test("publishes a sitemap of every public page", async ({ request }) => {
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
    expect(urls).not.toContain(`<loc>${SITE}/404/</loc>`)

    const appFrame = await request.get("/preview/app/")
    expect(appFrame.status()).toBe(200)
    expect(await appFrame.text()).toContain('name="robots" content="noindex"')
  })

  test("allows every crawler in robots.txt, the AI ones by name", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt")
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("text/plain")
    const robots = await response.text()

    expect(robots).toContain(`Sitemap: ${SITE}/sitemap-index.xml`)
    // Nothing is disallowed anywhere, /preview/app/ included: that page
    // carries a noindex meta, which a crawler only reads if it may fetch it.
    expect(robots).not.toContain("Disallow")

    // A named user-agent group inherits nothing from the `*` group (RFC 9309),
    // so every group has to repeat the rules it needs.
    const named: string[] = []
    for (const group of robots.split(/\n\s*\n/)) {
      const agents = [...group.matchAll(/^User-agent: (.+)$/gm)].map(
        ([, agent]) => agent
      )
      if (agents.length === 0) continue
      expect(group, agents.join(", ")).toContain("Allow: /")
      named.push(...agents)
    }
    for (const agent of CRAWLERS) expect(named, agent).toContain(agent)
  })

  test("publishes an llms.txt in the structure llmstxt.org describes", async ({
    request,
  }) => {
    const response = await request.get("/llms.txt")
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("text/plain")
    const llms = await response.text()
    const lines = llms.split("\n")

    // An H1, then a blockquote summary, then free prose. Headings start at H2.
    expect(lines[0]).toBe("# Bookmarks But Better")
    expect(lines[2]).toMatch(/^> \S/)
    expect(lines.filter((line) => line.startsWith("# "))).toHaveLength(1)
    expect(
      lines
        .filter((line) => line.startsWith("## "))
        .map((line) => line.slice(3))
    ).toEqual(LLMS_SECTIONS)

    // An H2 section is a file list: every line under one is a link, so the
    // prose and the product constraints stay in the preamble where an agent
    // reads them without following anything.
    let section = ""
    for (const line of lines) {
      if (line.startsWith("## ")) section = line.slice(3)
      else if (section && line.trim()) {
        const where = `${section}: ${line}`
        expect(line.startsWith("- ["), where).toBe(true)
        expect(line.match(/\((https:\/\/[^)]+)\)/)?.[1], where).toBeTruthy()
      }
    }

    // The facts worth having before any link is followed.
    const preamble = llms.slice(0, llms.indexOf("## "))
    expect(preamble).toContain("MIT")
    expect(preamble).toContain("127.0.0.1:52222")

    // Every page it lists is really there.
    const links = [...llms.matchAll(/\((https:\/\/[^)]+)\)/g)]
      .map(([, url]) => url)
      .filter((url) => url.startsWith(`${SITE}/`))
    expect(links.length).toBeGreaterThan(15)
    for (const url of links) {
      const page = await request.get(url.slice(SITE.length))
      expect(page.status(), url).toBe(200)
    }
    expect(llms).not.toContain(`(${SITE}/daemon/)`)
  })

  test("marks up each kind of page with valid structured data", async ({
    request,
  }) => {
    for (const { path, types } of STRUCTURED_DATA) {
      const blocks = structuredData(await (await request.get(path)).text())
      expect(
        blocks.map((block) => block["@type"]),
        path
      ).toEqual([...types])
      for (const block of blocks) {
        expect(block["@context"], path).toBe("https://schema.org")
      }
    }
  })

  test("describes the app, and names the site on the home page only", async ({
    request,
  }) => {
    const home = structuredData(await (await request.get("/")).text())

    const app = node(home, "SoftwareApplication")
    expect(app.name).toBe("Bookmarks But Better")
    // Free, said the way Google documents it.
    expect(app.offers).toMatchObject({ price: 0, priceCurrency: "USD" })
    expect(app.isAccessibleForFree).toBe(true)
    expect(Array.isArray(app.featureList)).toBe(true)
    expect(app.installUrl).toContain(
      "https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif"
    )
    expect(app.softwareHelp).toMatchObject({ url: `${SITE}/docs/` })
    // No `operatingSystem` at all: Chrome and Firefox are browsers, not
    // operating systems, and the page names no system for the extension —
    // which browsers it runs in is in `featureList`.
    expect(app.operatingSystem).toBeUndefined()
    // A screenshot of the app as this page serves it, not the composed social
    // card, which is a marketing image rather than a view of the product.
    expect(String(app.screenshot)).toMatch(/\/_astro\/dashboard-light\./)
    expect(String(app.screenshot)).not.toContain("og.png")
    // Store listings belong in `installUrl`; schema.org's `downloadUrl` means
    // a URL that yields a downloadable binary.
    expect(app.downloadUrl).toBeUndefined()
    // The project has no ratings, and inventing them is against Google's
    // structured-data policy.
    expect(app.aggregateRating).toBeUndefined()
    expect(app.review).toBeUndefined()

    // Google reads WebSite from the site's root URI and ignores it elsewhere.
    expect(node(home, "WebSite")).toMatchObject({
      url: `${SITE}/`,
      publisher: { "@type": "Person" },
    })
    for (const { path } of STRUCTURED_DATA.slice(1)) {
      const blocks = structuredData(await (await request.get(path)).text())
      expect(
        blocks.map((block) => block["@type"]),
        path
      ).not.toContain("WebSite")
    }
  })

  test("declares og:type by page kind and points at llms.txt", async ({
    request,
  }) => {
    for (const [path, type] of [
      ["/", "website"],
      ["/preview/", "website"],
      ["/privacy/", "website"],
      ["/docs/", "article"],
      ["/docs/start/install/", "article"],
    ] as const) {
      const html = await (await request.get(path)).text()
      // Starlight hardcodes `article` everywhere; the site pages override it,
      // and exactly one tag survives the merge.
      expect(
        [...html.matchAll(/<meta property="og:type" content="([^"]+)"/g)].map(
          ([, content]) => content
        ),
        path
      ).toEqual([type])
      expect(html, path).toContain(
        'rel="alternate" type="text/plain" href="/llms.txt"'
      )
    }
  })

  test("serves a social card at the size its meta tags declare", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text()
    const declared = (dimension: "width" | "height") =>
      Number(
        html.match(
          new RegExp(`<meta property="og:image:${dimension}" content="(\\d+)"`)
        )?.[1]
      )
    expect(declared("width")).toBeGreaterThan(0)
    expect(declared("height")).toBeGreaterThan(0)

    // A PNG's IHDR chunk holds the real size as two big-endian uint32s, at
    // bytes 16 and 20, so the file answers for itself: the card cannot be
    // regenerated at another size without this failing.
    const png = await (await request.get("/og.png")).body()
    expect(png.subarray(1, 4).toString()).toBe("PNG")
    expect(png.readUInt32BE(16)).toBe(declared("width"))
    expect(png.readUInt32BE(20)).toBe(declared("height"))
  })

  test("gives every product screenshot alt text", async ({ page }) => {
    await page.goto("/")
    // Both mode versions of every screenshot are in the document, and each one
    // demonstrates a named feature, so none of them is decorative.
    const images = page.locator("#demo img, #features img, #themes img")
    const count = await images.count()
    expect(count).toBeGreaterThan(5)
    for (let index = 0; index < count; index++) {
      const alt = await images.nth(index).getAttribute("alt")
      expect(alt?.length, `image ${index}`).toBeGreaterThan(20)
    }
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
