import { expect, test, type Page } from "@playwright/test"

/**
 * The dashboard grid operated without a pointer.
 *
 * The assertions about *where* focus went are geometric on purpose: the point
 * of the arrow keys here is that they follow the masonry the user is looking
 * at, and the only way to say that without restating the implementation is to
 * measure the boxes.
 */

const GRID_ITEM =
  '[data-testid="bookmark-card"] a[tabindex], [data-testid="bookmark-card"] h3[tabindex]'

interface FocusedBox {
  /** Document coordinates, so a scroll caused by focusing does not move them. */
  x: number
  y: number
  tag: string
}

async function focusedBox(page: Page): Promise<FocusedBox> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x + window.scrollX,
      y: rect.y + window.scrollY,
      tag: element.tagName,
    }
  })
}

/** Focuses the grid's current tab stop, which is the first card's heading. */
async function focusGrid(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="bookmark-card"]')
  await page.evaluate(() => {
    const stop = document.querySelector(
      '[data-testid="bookmark-card"] h3[tabindex="0"]'
    ) as HTMLElement | null
    stop?.focus()
  })
}

test("the whole grid is one tab stop, not one per bookmark", async ({
  page,
}) => {
  await page.goto("/")
  await page.waitForSelector('[data-testid="bookmark-card"]')

  const stops = page.locator(GRID_ITEM).and(page.locator('[tabindex="0"]'))
  await expect(stops).toHaveCount(1)

  // The rest of the grid is reachable, just not by Tab: crossing this page
  // was the reason the grid became a composite widget at all.
  const roved = page.locator(GRID_ITEM).and(page.locator('[tabindex="-1"]'))
  expect(await roved.count()).toBeGreaterThan(50)
})

test("arrow keys travel the columns the masonry drew", async ({ page }) => {
  await page.goto("/")
  await focusGrid(page)

  const start = await focusedBox(page)
  expect(start.tag).toBe("H3")

  await page.keyboard.press("ArrowDown")
  const below = await focusedBox(page)
  expect(below.y).toBeGreaterThan(start.y)
  expect(Math.abs(below.x - start.x)).toBeLessThan(40)

  await page.keyboard.press("ArrowUp")
  expect(await focusedBox(page)).toEqual(start)

  await page.keyboard.press("ArrowRight")
  const right = await focusedBox(page)
  expect(right.x).toBeGreaterThan(start.x + 200)

  await page.keyboard.press("ArrowLeft")
  expect(await focusedBox(page)).toEqual(start)

  // End walks past every card boundary in the column, so it has to land
  // below everything the column holds.
  await page.keyboard.press("End")
  const last = await focusedBox(page)
  expect(last.y).toBeGreaterThan(below.y)
  expect(Math.abs(last.x - start.x)).toBeLessThan(40)

  await page.keyboard.press("Home")
  expect(await focusedBox(page)).toEqual(start)
})

test("Enter opens the focused bookmark", async ({ page }) => {
  // Everything off the dev server is stubbed, so the bookmark opens without
  // the test ever leaving the machine.
  await page.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>opened</title>",
      })
  )

  await page.goto("/")
  await page.waitForSelector('[data-testid="bookmark-card"]')

  const href = await page.evaluate(() => {
    const link = document.querySelector(
      '[data-testid="bookmark-card"] a[href]'
    ) as HTMLAnchorElement
    link.focus()
    return link.href
  })

  await page.keyboard.press("Enter")
  await page.waitForURL(href)
  expect(page.url()).toBe(href)
})

test("Alt and an arrow reorder the focused bookmark in its folder", async ({
  page,
}) => {
  await page.goto("/")

  const card = page
    .getByTestId("bookmark-card")
    .filter({ has: page.getByRole("heading", { name: "Social", exact: true }) })
  await expect(card).toBeVisible()

  const hrefs = () =>
    card
      .locator("a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")))

  const before = await hrefs()
  expect(before.length).toBeGreaterThan(2)

  await card.locator("a").first().focus()
  await page.keyboard.press("Alt+ArrowDown")

  await expect.poll(hrefs).toEqual([before[1], before[0], ...before.slice(2)])

  // And back, so the move is a reorder rather than a one-way shuffle.
  await page.keyboard.press("Alt+ArrowUp")
  await expect.poll(hrefs).toEqual(before)
})

test("the same keys reorder through whole-folder ordering in a Vault", async ({
  page,
}) => {
  await page.goto("/")

  // A Daemon Source has `reorder: false` and `setChildOrder: true`, so this
  // is the other write path — the one whose absence would be silent.
  await page
    .getByRole("tablist", { name: "Bookmark source" })
    .getByRole("tab")
    .filter({ hasText: "reading" })
    .click()

  const card = page.getByTestId("bookmark-card").filter({
    has: page.getByRole("heading", { name: "Articles", exact: true }),
  })
  await expect(card).toBeVisible()

  const titles = () =>
    card
      .locator("a span:last-child")
      .evaluateAll((spans) => spans.map((span) => span.textContent))

  await expect
    .poll(titles)
    .toEqual([
      "SQLite is not a toy database",
      "The B-tree database",
      "Writing a simple JSON parser",
    ])

  await card.locator("a").first().focus()
  await page.keyboard.press("Alt+ArrowDown")

  await expect
    .poll(titles)
    .toEqual([
      "The B-tree database",
      "SQLite is not a toy database",
      "Writing a simple JSON parser",
    ])
})

test("typing over a focused bookmark still opens the search palette", async ({
  page,
}) => {
  await page.goto("/")
  await page.waitForSelector('[data-testid="bookmark-card"]')
  await page.evaluate(() => {
    const link = document.querySelector(
      '[data-testid="bookmark-card"] a[href]'
    ) as HTMLElement
    link.focus()
  })

  await page.keyboard.press("g")

  const search = page.getByRole("combobox", { name: "Search bookmarks" })
  await expect(search).toBeVisible()
  await expect(search).toHaveValue("g")
})

const COLOR_THEMES = [
  "default",
  "amber-minimal",
  "claude",
  "claymorphism",
  "solar-dusk",
  "t3-chat",
  "vintage-paper",
  "bubblegum",
  "caffeine",
  "cyberpunk",
]

/** A colour function whose last component is zero, i.e. fully transparent. */
const INVISIBLE = /[,/]\s*0\)$/

test("the focused item is visibly ringed in every theme, light and dark", async ({
  page,
}) => {
  await page.goto("/")

  await focusGrid(page)
  // Moving with a key is what makes the browser call this focus visible; the
  // same element focused by script would not draw the ring.
  await page.keyboard.press("ArrowDown")

  for (const theme of COLOR_THEMES) {
    for (const scheme of ["light", "dark"]) {
      const label = `${theme}/${scheme}`
      await page.evaluate(
        ({ theme, scheme }) => {
          const root = document.documentElement
          if (theme === "default") {
            root.removeAttribute("data-color-theme")
          } else {
            root.setAttribute("data-color-theme", theme)
          }
          root.classList.toggle("dark", scheme === "dark")
        },
        { theme, scheme }
      )

      // Net zero movement, but both presses are real keyboard focus moves,
      // so the ring is drawn wherever the previous theme left the tab stop.
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("ArrowUp")

      const boxShadow = await page.evaluate(
        () => getComputedStyle(document.activeElement as Element).boxShadow
      )

      // Tailwind paints the ring as one 3px spread layer among several
      // transparent placeholders, so the layer has to be picked out before
      // its colour means anything.
      const ring = /(\S+\([^)]*\))\s+0px 0px 0px 3px/.exec(boxShadow)
      expect(ring, label).not.toBeNull()
      expect(ring![1], label).not.toMatch(INVISIBLE)

      // `focus-visible:border-ring` is the other half of the convention, and
      // it is the half that silently does nothing if a theme has no `--ring`.
      // Polled because the row's `transition-colors` covers border-color: read
      // on the same tick as the keypress, it is still the transparent value it
      // is animating away from.
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                getComputedStyle(document.activeElement as Element)
                  .borderTopColor
            ),
          { message: label }
        )
        .not.toMatch(INVISIBLE)
    }
  }
})
