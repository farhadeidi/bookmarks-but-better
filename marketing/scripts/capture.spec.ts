import { test } from "@playwright/test"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUT = path.resolve(__dirname, "../output")

test("capture store screenshots and promo tiles", async ({ page }) => {
  // Force dark mode for all captures
  await page.addInitScript(() => localStorage.setItem("theme", "dark"))

  // ─── 01-dashboard.png (1280×800) ──────────────────────────────────
  // Shows the dashboard with a hovered bookmark and HoverCard popup visible
  await test.step("01-dashboard", async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/?screenshot=true")
    await page.waitForLoadState("networkidle")
    await page.locator('a[href*="youtube.com"]').first().hover()
    await page.waitForSelector('[data-slot="hover-card-content"]', {
      timeout: 3_000,
    })
    await page.waitForTimeout(200) // let entry animation finish
    // Inject a visible pointer cursor (Cursor02Icon from hugeicons) —
    // headless Playwright doesn't render the OS cursor
    const linkBox = await page
      .locator('a[href*="youtube.com"]')
      .first()
      .boundingBox()
    if (linkBox) {
      // Cursor tip is at approx (5, 2) in the 24×24 viewBox
      const tipX = linkBox.x + 42
      const tipY = linkBox.y + linkBox.height / 2 + 2
      await page.evaluate(
        ({ x, y }) => {
          const ns = "http://www.w3.org/2000/svg"
          const svg = document.createElementNS(ns, "svg")
          svg.setAttribute("width", "22")
          svg.setAttribute("height", "22")
          svg.setAttribute("viewBox", "0 0 24 24")
          svg.style.cssText = `position:fixed;left:${x - 3}px;top:${y - 3}px;pointer-events:none;z-index:999999;overflow:visible;`

          const path = document.createElementNS(ns, "path")
          path.setAttribute(
            "d",
            "M9.80282 4.62973L15.8364 6.99069C19.3164 8.35243 21.0564 9.03329 20.9987 10.1133C20.941 11.1934 19.1251 11.6886 15.4933 12.6791C14.412 12.974 13.8713 13.1215 13.4964 13.4963C13.1215 13.8712 12.9741 14.4119 12.6791 15.4933C11.6887 19.125 11.1934 20.9409 10.1134 20.9986C9.03335 21.0563 8.35249 19.3163 6.99075 15.8363L4.62979 9.80276C3.20411 6.15934 2.49127 4.33764 3.41448 3.41442C4.3377 2.49121 6.15941 3.20405 9.80282 4.62973Z"
          )
          path.setAttribute("fill", "white")
          path.setAttribute("stroke", "#888888")
          path.setAttribute("stroke-width", "1")
          path.setAttribute("stroke-linejoin", "round")
          svg.appendChild(path)
          document.body.appendChild(svg)
        },
        { x: tipX, y: tipY }
      )
      // Wait two animation frames to ensure the element is painted before screenshotting
      await page.evaluate(
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r))
          )
      )
    }
    await page.screenshot({ path: `${OUT}/01-dashboard.png` })
  })

  // ─── 02-organizer.png (1280×800) ──────────────────────────────────
  await test.step("02-organizer", async () => {
    await page.goto("/?screenshot=true")
    await page.waitForLoadState("networkidle")
    await page.getByRole("button", { name: "Bookmark Organizer" }).click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/02-organizer.png` })
  })

  // ─── 03-themes.png — 4 diagonal theme strips (1280×800) ─────────────
  // Same layout, 4 themes, diagonal cuts like the four-seasons photo style
  await test.step("03-themes", async () => {
    const themes = [
      "default",
      "cyberpunk",
      "bubblegum",
      "solar-dusk",
      "t3-chat",
    ] as const
    const captures: string[] = []
    const W = 1280,
      H = 800,
      SLANT = Math.round(H * Math.tan((20 * Math.PI) / 180)) // 20° from vertical ≈ 291px
    const n = themes.length,
      sw = W / n // 5 strips, nominal width = 256px

    for (const theme of themes) {
      await page.setViewportSize({ width: W, height: H })
      await page.goto("/?screenshot=true")
      await page.waitForLoadState("networkidle")
      await page.evaluate((t) => {
        if (t === "default") {
          document.documentElement.removeAttribute("data-color-theme")
        } else {
          document.documentElement.setAttribute("data-color-theme", t)
        }
      }, theme)
      await page.waitForTimeout(200)
      captures.push((await page.screenshot({ type: "png" })).toString("base64"))
    }

    // Compose via SVG <image> + <clipPath>
    // Geometry: equal top spacing, bottoms shifted right by SLANT, outer edges vertical
    // "start lines from 100px left" → shift each divider 100px left from natural position
    const LINE_OFFSET = -150
    const divTops = Array.from(
      { length: n - 1 },
      (_, i) => (i + 1) * sw - LINE_OFFSET
    )
    const divBots = divTops.map((t) => t - SLANT)

    const pts = captures.map((_, i) => {
      const tl = i === 0 ? 0 : divTops[i - 1]
      const tr = i === n - 1 ? W : divTops[i]
      const bl = i === 0 ? 0 : divBots[i - 1]
      const br = i === n - 1 ? W : divBots[i]
      return `${tl},0 ${tr},0 ${br},${H} ${bl},${H}`
    })

    const defs = pts
      .map((p, i) => `<clipPath id="c${i}"><polygon points="${p}"/></clipPath>`)
      .join("")
    const images = captures
      .map(
        (b64, i) =>
          `<image href="data:image/png;base64,${b64}" clip-path="url(#c${i})" width="${W}" height="${H}"/>`
      )
      .join("")
    const dividers = Array.from(
      { length: n - 1 },
      (_, i) =>
        `<line x1="${divTops[i]}" y1="0" x2="${divBots[i]}" y2="${H}" stroke="rgba(255,255,255,0.55)" stroke-width="2"/>`
    ).join("")

    await page.setViewportSize({ width: W, height: H })
    await page.setContent(
      `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>* { margin:0; padding:0; } body { width:${W}px; height:${H}px; overflow:hidden; background:#0a0a0a; }</style>
      </head><body>
      <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
        <rect width="${W}" height="${H}" fill="#0a0a0a"/>
        <defs>${defs}</defs>
        ${images}
        ${dividers}
      </svg>
      </body></html>`,
      { waitUntil: "load" }
    )
    await page.screenshot({ path: `${OUT}/03-themes.png` })
  })

  // ─── 04-settings.png (1280×800) ───────────────────────────────────
  await test.step("04-settings", async () => {
    await page.goto("/?screenshot=true")
    await page.waitForLoadState("networkidle")
    await page.getByRole("button", { name: "Settings" }).click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/04-settings.png` })
  })

  // ─── 05-inline-edit.png (1280×800) ───────────────────────────────────
  await test.step("05-inline-edit", async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto("/?screenshot=true")
    await page.waitForLoadState("networkidle")
    await page.locator('a[href*="youtube.com"]').first().hover()
    await page.waitForSelector('[data-slot="hover-card-content"]', {
      timeout: 3_000,
    })
    await page.waitForTimeout(200)
    // Click the edit button (first icon button in the HoverCard: pencil/edit)
    await page
      .locator('[data-slot="hover-card-content"] button')
      .first()
      .click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/05-inline-edit.png` })
  })

  // ─── promo-small.png (440×280) ────────────────────────────────────
  await test.step("promo-small", async () => {
    await page.setViewportSize({ width: 440, height: 280 })
    await page.goto("/?screenshot=true")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/promo-small.png` })
  })

  // ─── promo-marquee.png (1400×560) ─────────────────────────────────
  await test.step("promo-marquee", async () => {
    await page.setViewportSize({ width: 1400, height: 560 })
    await page.goto("/?screenshot=true")
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/promo-marquee.png` })
  })
})
