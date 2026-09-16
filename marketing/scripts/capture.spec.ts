/**
 * Store, promo and website images, captured from the Dev Workbench.
 *
 * Every scene is the real app at 1280×800, captured at 2x so the composed
 * images stay sharp when scaled. Scenes are then composed into:
 *
 * - marketing/output/store/  captioned 1280×800 screenshots (Chrome uses the
 *                            first five; AMO takes all six)
 * - marketing/output/        promo-small (440×280), promo-marquee (1400×560)
 * - website/public/          og.png (1200×630)
 * - website/src/assets/screenshots/  uncaptioned website screenshots
 *
 * Captions and visual language follow website/BRAND.md ("Modern editorial").
 */
import { test, type Browser } from "@playwright/test"
import fs from "fs"
import path from "path"
import {
  APP_H,
  APP_W,
  CAPTION_CSS,
  FULL,
  ROOT,
  browserWindow,
  caption,
  crop,
  render,
  type Region,
} from "./brand"

const OUT = path.join(ROOT, "marketing/output")
const STORE = path.join(OUT, "store")
const SITE = path.join(ROOT, "website/public")
const APP = "http://localhost:5173"

type Mode = "dark" | "light"

interface Scene {
  mode: Mode
  colorTheme: string
  /** Puts the app into the state the image shows. */
  act?: (page: import("@playwright/test").Page) => Promise<void>
}

async function captureScene(browser: Browser, scene: Scene): Promise<string> {
  const context = await browser.newContext({
    viewport: { width: APP_W, height: APP_H },
    deviceScaleFactor: 2,
  })
  try {
    const page = await context.newPage()
    await page.addInitScript(
      (mode) => localStorage.setItem("theme", mode),
      scene.mode
    )
    await page.goto(`${APP}/?scenario=browser-daemon&screenshot=true`)
    await page.waitForLoadState("networkidle")
    await page.addStyleTag({
      content: `[aria-label="Open Dev Workbench"]{display:none!important}`,
    })
    await page.evaluate((theme) => {
      if (theme === "default") {
        document.documentElement.removeAttribute("data-color-theme")
      } else {
        document.documentElement.setAttribute("data-color-theme", theme)
      }
    }, scene.colorTheme)
    // Favicons load after the first paint.
    await page.waitForTimeout(1500)
    if (scene.act) {
      await scene.act(page)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(700)
    }
    const png = await page.screenshot({ type: "png" })
    return png.toString("base64")
  } finally {
    await context.close()
  }
}

/** A captioned store screenshot: headline above, the app below, bleeding off the bottom. */
function storeShot(
  index: number,
  headline: string,
  sub: string,
  scene: string
) {
  return (
    caption(index, headline, sub) +
    browserWindow(scene, { left: 80, top: 262, width: 1120 })
  )
}

const THEME_LABEL: Record<string, string> = {
  "amber-minimal": "Amber Minimal",
  bubblegum: "Bubblegum",
  cyberpunk: "Cyberpunk",
  "vintage-paper": "Vintage Paper",
  claude: "Claude",
  "t3-chat": "T3 Chat",
}

// ─── The run ─────────────────────────────────────────────────────────────

test("capture store, promo and website images", async ({ browser }) => {
  test.setTimeout(300_000)

  const dashboard = await captureScene(browser, {
    mode: "dark",
    colorTheme: "amber-minimal",
  })
  const sources = await captureScene(browser, {
    mode: "light",
    colorTheme: "amber-minimal",
    act: (page) =>
      page.getByRole("button", { name: /Bookmark source/ }).click(),
  })
  const search = await captureScene(browser, {
    mode: "dark",
    colorTheme: "amber-minimal",
    act: async (page) => {
      await page.getByRole("button", { name: "Search bookmarks" }).click()
      await page.keyboard.type("git", { delay: 40 })
    },
  })
  const organizer = await captureScene(browser, {
    mode: "light",
    colorTheme: "amber-minimal",
    act: async (page) => {
      await page.getByRole("button", { name: "Bookmark tree" }).click()
      await page.getByText("Folders Only").click()
      await page.getByRole("button", { name: "Expand All" }).click()
    },
  })
  const importPanel = await captureScene(browser, {
    mode: "dark",
    colorTheme: "amber-minimal",
    act: async (page) => {
      await page.getByRole("button", { name: "Settings" }).click()
      await page
        .locator('[role="dialog"]')
        .getByText("Data & Migration", { exact: true })
        .click()
    },
  })
  const themeScenes: [string, Mode][] = [
    ["amber-minimal", "dark"],
    ["bubblegum", "light"],
    ["cyberpunk", "dark"],
    ["vintage-paper", "light"],
    ["claude", "dark"],
    ["t3-chat", "light"],
  ]
  const themes: { label: string; scene: string }[] = []
  for (const [colorTheme, mode] of themeScenes) {
    themes.push({
      label: `${THEME_LABEL[colorTheme]} · ${mode === "dark" ? "Dark" : "Light"}`,
      scene: await captureScene(browser, { mode, colorTheme }),
    })
  }

  const STORE_SIZE = { width: 1280, height: 800 }
  const THEME_REGION: Region = { x: 0, y: 0, w: 720, h: 405 }
  const themeGrid = (left: number, top: number, cell: number, gap: number) =>
    themes
      .map(({ label, scene }, i) =>
        browserWindow(
          scene,
          {
            left: left + (i % 3) * (cell + gap),
            top: top + Math.floor(i / 3) * (cell * (405 / 720) + 34 + gap),
            width: cell,
          },
          label,
          THEME_REGION
        )
      )
      .join("")

  // ─── Store screenshots ──────────────────────────────────────────────
  await test.step("store screenshots", async () => {
    fs.rmSync(STORE, { recursive: true, force: true })
    const shots: [string, string, string, string][] = [
      [
        "01-new-tab",
        "Your bookmarks, <em>as a beautiful new tab</em>",
        "Every folder becomes a card. Local and private: no account, no tracking.",
        dashboard,
      ],
      [
        "02-sources",
        "Browser or Markdown vault. <em>Never mixed.</em>",
        "Switch sources from the top of the dashboard, and start from any folder you like.",
        sources,
      ],
      [
        "03-search",
        "Find any bookmark <em>in a keystroke</em>",
        "Search titles and URLs from the new tab, or type bb in the address bar.",
        search,
      ],
      [
        "04-organizer",
        "A real organizer, <em>right in the new tab</em>",
        "Drag, reorder, rename, create and delete across your whole bookmark tree.",
        organizer,
      ],
    ]
    for (const [i, [name, headline, sub, scene]] of shots.entries()) {
      await render(
        browser,
        `${STORE}/${name}.png`,
        STORE_SIZE,
        storeShot(i + 1, headline, sub, scene),
        CAPTION_CSS
      )
    }
    await render(
      browser,
      `${STORE}/05-themes.png`,
      STORE_SIZE,
      caption(
        5,
        "Ten themes, <em>light and dark</em>",
        "Pick the look that suits you. Preferences stay in your browser profile."
      ) + themeGrid(80, 262, 360, 20),
      CAPTION_CSS
    )
    await render(
      browser,
      `${STORE}/06-import.png`,
      STORE_SIZE,
      storeShot(
        6,
        "Bring your bookmarks <em>with you</em>",
        "Import HTML from any browser, or CSV from Raindrop and Pocket. Export any time.",
        importPanel
      ),
      CAPTION_CSS
    )
  })

  // ─── Promo tiles and social card ─────────────────────────────────────
  await test.step("promo tiles", async () => {
    const heroCss = (h1: number, sub: number) => `
      .hero { position: absolute; }
      .hero .eyebrow { font-size: 16px; line-height: 1.5; font-weight: 500; color: var(--primary); }
      .hero h1 { font-size: ${h1}px; line-height: 1.0; margin-top: 18px; letter-spacing: -0.035em; }
      .hero p { font-size: ${sub}px; line-height: 1.5; color: var(--muted); margin-top: 20px; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 26px; }
      .chips span { font-size: 13px; color: var(--fg); padding: 6px 12px; border-radius: 999px; border: 1px solid var(--hairline); background: oklch(1 0 0 / 4%); }
      .glow { background: radial-gradient(50% 70% at 75% 10%, oklch(0.72 0.13 70 / 0.18), transparent 70%); }
    `
    const chips = `<div class="chips"><span>No account</span><span>No tracking</span><span>Markdown vaults</span><span>Open source</span></div>`

    await render(
      browser,
      `${OUT}/promo-marquee.png`,
      { width: 1400, height: 560 },
      `<div class="hero" style="left:72px;top:92px;width:520px">
        <div class="eyebrow">New tab extension · Chrome · Firefox</div>
        <h1 class="display">Bookmarks,<br>but <em>better</em></h1>
        <p>Your bookmarks as a beautiful new tab.<br>Local, private, no account.</p>
        ${chips}
      </div>` + browserWindow(dashboard, { left: 640, top: 72, width: 900 }),
      heroCss(84, 20)
    )

    await render(
      browser,
      `${SITE}/og.png`,
      { width: 1200, height: 630 },
      `<div class="hero" style="left:64px;top:118px;width:500px">
        <div class="eyebrow">New tab extension · Chrome · Firefox</div>
        <h1 class="display">Bookmarks,<br>but <em>better</em></h1>
        <p>Your bookmarks as a beautiful new tab.<br>Local, private, no account.</p>
        ${chips}
      </div>` + browserWindow(dashboard, { left: 580, top: 84, width: 820 }),
      heroCss(80, 20)
    )

    await render(
      browser,
      `${OUT}/promo-small.png`,
      { width: 440, height: 280 },
      `<div class="hero" style="left:28px;top:52px;width:250px">
        <h1 class="display">Bookmarks,<br>but <em>better</em></h1>
        <p>A beautiful, private<br>new tab for your bookmarks.</p>
      </div>` + browserWindow(dashboard, { left: 250, top: 40, width: 420 }),
      heroCss(38, 13) +
        `.hero h1{margin-top:0} .hero p{margin-top:14px} .bar{height:22px;padding:0 9px;gap:5px} .bar i{width:6px;height:6px} .bar span{display:none}`
    )
  })

  // ─── Website screenshots (uncaptioned, the site supplies the copy) ────
  await test.step("website screenshots", async () => {
    // Imported by the site through astro:assets, which emits responsive
    // AVIF/WebP variants at build time.
    const dir = path.join(ROOT, "website/src/assets/screenshots")
    fs.rmSync(dir, { recursive: true, force: true })
    const SIZE = { width: 1400, height: 875 }
    const cropTo = (scene: string, region: Region) =>
      crop(scene, SIZE.width, region)
    const flat = `.glow{display:none} body{background:#0b0b0b}`

    await render(
      browser,
      `${dir}/dashboard.png`,
      SIZE,
      cropTo(dashboard, FULL),
      flat
    )
    await render(
      browser,
      `${dir}/organizer.png`,
      SIZE,
      cropTo(organizer, { x: 400, y: 0, w: 880, h: 550 }),
      flat
    )
    await render(
      browser,
      `${dir}/sources.png`,
      SIZE,
      cropTo(sources, { x: 0, y: 0, w: 640, h: 400 }),
      flat
    )
    await render(
      browser,
      `${dir}/search.png`,
      SIZE,
      cropTo(search, { x: 320, y: 60, w: 640, h: 400 }),
      flat
    )
    await render(
      browser,
      `${dir}/themes.png`,
      SIZE,
      themeGrid(70, 163, 400, 30),
      `body{background:var(--bg)}`
    )
  })
})
