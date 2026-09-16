/**
 * The marketing composition kit shared by the image and video scripts:
 * brand fonts and colors from website/BRAND.md, a browser-window frame for app
 * captures, and a renderer that turns an HTML composition into a PNG.
 */
import type { Browser } from "@playwright/test"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
)

export const APP_W = 1280
export const APP_H = 800

const FONTS = path.join(ROOT, "website/node_modules/@fontsource-variable")

/**
 * One face for everything, the same file the site loads (astro.config.ts): the
 * `opsz` build carries the weight and optical size axes together, so display
 * sizes get Inter Display's drawing without a second font.
 */
function fontFaces() {
  const file = "inter/files/inter-latin-opsz-normal.woff2"
  const fontPath = path.join(FONTS, file)
  if (!fs.existsSync(fontPath)) {
    // The brand font is the website's dependency, not the root's.
    throw new Error(
      `Missing brand font ${path.relative(ROOT, fontPath)}. Run \`bun install --cwd website\` first.`
    )
  }
  const data = fs.readFileSync(fontPath).toString("base64")
  return `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${data}) format("woff2")}`
}

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: oklch(0.17 0.006 80);
    --fg: oklch(0.94 0.004 90);
    --muted: oklch(0.72 0.008 80);
    --primary: oklch(0.72 0.13 70);
    --hairline: oklch(1 0 0 / 11%);
  }
  body {
    position: relative; overflow: hidden;
    background: var(--bg); color: var(--fg);
    font-family: Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .glow {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(60% 55% at 50% 0%, oklch(0.72 0.13 70 / 0.16), transparent 70%);
  }
  /* Display type is the body face set heavier and tighter — no second family.
     An <em> is the hero's accent word: lighter against the semibold line,
     never a slant (Inter's italic reads as a mistake at this size). */
  .display { font-weight: 600; letter-spacing: -0.03em; }
  .display em { font-style: normal; font-weight: 400; }
  .window {
    position: absolute; overflow: hidden; border-radius: 14px;
    background: #0b0b0b;
    box-shadow:
      0 0 0 1px oklch(1 0 0 / 10%),
      0 40px 90px -30px rgb(0 0 0 / 0.8),
      0 0 140px -40px oklch(0.72 0.13 70 / 0.45);
  }
  .bar {
    position: relative; height: 34px; display: flex; align-items: center; gap: 7px; padding: 0 14px;
    background: oklch(0.23 0.006 80); border-bottom: 1px solid oklch(1 0 0 / 7%);
  }
  .bar i { width: 10px; height: 10px; border-radius: 50%; background: oklch(1 0 0 / 16%); }
  .bar span {
    position: absolute; left: 50%; transform: translateX(-50%);
    width: min(260px, calc(100% - 150px)); text-align: center; font-size: 12px; color: var(--muted);
    padding: 4px 12px; border-radius: 7px; background: oklch(1 0 0 / 6%);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .crop { position: relative; overflow: hidden; }
  .crop img { position: absolute; display: block; }
`

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export const FULL: Region = { x: 0, y: 0, w: APP_W, h: APP_H }

/** A region of a base64 PNG scene, scaled to `width` CSS pixels. */
export function crop(scene: string, width: number, region: Region = FULL) {
  const s = width / region.w
  return `<div class="crop" style="width:${width}px;height:${region.h * s}px">
    <img src="data:image/png;base64,${scene}" style="width:${APP_W * s}px;left:${-region.x * s}px;top:${-region.y * s}px">
  </div>`
}

/** A browser window around a scene; pass `scene: null` for an empty frame. */
export function browserWindow(
  scene: string | null,
  box: { left: number; top: number; width: number },
  label = "New Tab",
  region: Region = FULL
) {
  const content =
    scene === null
      ? `<div style="height:${(box.width * region.h) / region.w}px"></div>`
      : crop(scene, box.width, region)
  return `<div class="window" style="left:${box.left}px;top:${box.top}px;width:${box.width}px">
    <div class="bar"><i></i><i></i><i></i><span>${label}</span></div>
    ${content}
  </div>`
}

export async function render(
  browser: Browser,
  file: string,
  size: { width: number; height: number },
  body: string,
  css = ""
) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 })
  try {
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}${BASE_CSS}
        body{width:${size.width}px;height:${size.height}px}${css}</style></head>
        <body><div class="glow"></div>${body}</body></html>`,
      { waitUntil: "load" }
    )
    await page.evaluate(() => document.fonts.ready)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await page.screenshot({ path: file })
  } finally {
    await page.close()
  }
}

export const CAPTION_CSS = `
  .caption { position: absolute; left: 0; right: 0; top: 58px; text-align: center; }
  .caption .index { font-size: 19px; font-weight: 500; color: var(--primary); }
  .caption h1 { margin-top: 10px; font-size: 52px; line-height: 1.08; }
  .caption p { margin: 16px auto 0; max-width: 780px; font-size: 19px; line-height: 1.5; color: var(--muted); }
`

export function caption(index: number, headline: string, sub: string) {
  return `<div class="caption">
    <div class="index">${String(index).padStart(2, "0")} —</div>
    <h1 class="display">${headline}</h1>
    <p>${sub}</p>
  </div>`
}
