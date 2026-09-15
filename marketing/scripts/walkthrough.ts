/**
 * The product walkthrough video: marketing/output/videos/bookmarks-but-better.mp4
 * (1920×1080, 60 fps, silent).
 *
 * Needs the Dev Workbench running (`bun run dev`). Each scene drives the real
 * app with a visible cursor while a CDP screencast records it at 2x; ffmpeg
 * then places every recording in the brand frame under its caption and joins
 * the scenes with crossfades between a title card and a closing card.
 */
import { chromium, type Locator, type Page } from "@playwright/test"
import { execFileSync } from "child_process"
import ffmpeg from "ffmpeg-static"
import fs from "fs"
import path from "path"
import { APP_H, APP_W, ROOT, browserWindow, render } from "./brand"

const APP = "http://localhost:5173/?scenario=browser-daemon&screenshot=true"
const OUT = path.join(ROOT, "marketing/output/videos")
const WORK = path.join(OUT, "work")
const FILE = path.join(OUT, "bookmarks-but-better.mp4")

const W = 1920
const H = 1080
const FPS = 60
const FADE = 0.5
const BAR = 40
const WINDOW = { left: 240, top: 214, width: 1440 }
const APP_BOX = {
  x: WINDOW.left,
  y: WINDOW.top + BAR,
  w: WINDOW.width,
  h: (WINDOW.width * APP_H) / APP_W,
}

if (!ffmpeg) throw new Error("ffmpeg-static has no binary for this platform")
const FFMPEG = ffmpeg

function run(args: string[]) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  })
}

// ─── The cursor ──────────────────────────────────────────────────────────
// Headless Chromium draws no pointer, so the page gets one that follows the
// real mouse (and native drags) plus a soft ring on every press. It is plain
// JavaScript in a string: a TypeScript function would be serialized with the
// helpers tsx compiles into it, which do not exist in the page.

const CURSOR_CSS = `
  [aria-label="Open Dev Workbench"] { display: none !important; }
  #bbb-cursor { position: fixed; left: -3px; top: -2px; z-index: 2147483647; pointer-events: none;
    transform: translate(-100px, -100px); filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.35)); }
  #bbb-cursor svg { display: block; transform-origin: 3px 2px; transition: transform 120ms ease; }
  #bbb-cursor.down svg { transform: scale(0.86); }
  .bbb-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 44px; height: 44px;
    margin: -22px 0 0 -22px; border-radius: 50%; border: 2px solid oklch(0.72 0.13 70);
    animation: bbb-ring 520ms ease-out forwards; }
  @keyframes bbb-ring { from { opacity: 0.9; transform: scale(0.3); } to { opacity: 0; transform: scale(1.3); } }
`

const CURSOR_SVG = `<svg width="22" height="26" viewBox="0 0 22 26"><path d="M3 2 L3 20.5 L7.8 16 L11.2 23.2 L14.4 21.7 L11 14.6 L17.6 14.6 Z" fill="white" stroke="black" stroke-width="1.4" stroke-linejoin="round"/></svg>`

const CURSOR_SCRIPT = `
addEventListener("DOMContentLoaded", function () {
  var style = document.createElement("style");
  style.textContent = ${JSON.stringify(CURSOR_CSS)};
  document.head.appendChild(style);
  var cursor = document.createElement("div");
  cursor.id = "bbb-cursor";
  cursor.innerHTML = ${JSON.stringify(CURSOR_SVG)};
  document.body.appendChild(cursor);
  function follow(event) {
    if (!event.clientX && !event.clientY) return;
    cursor.style.transform = "translate(" + event.clientX + "px, " + event.clientY + "px)";
  }
  ["mousemove", "pointermove", "dragover", "drag"].forEach(function (type) {
    document.addEventListener(type, follow, true);
  });
  document.addEventListener("mousedown", function (event) {
    cursor.classList.add("down");
    var ring = document.createElement("div");
    ring.className = "bbb-ring";
    ring.style.left = event.clientX + "px";
    ring.style.top = event.clientY + "px";
    document.body.appendChild(ring);
    setTimeout(function () { ring.remove(); }, 600);
  }, true);
  ["mouseup", "dragend", "drop"].forEach(function (type) {
    document.addEventListener(type, function () { cursor.classList.remove("down"); }, true);
  });
});
`

class Pointer {
  x = 900
  y = 40

  constructor(private page: Page) {}

  async park() {
    await this.page.mouse.move(this.x, this.y)
  }

  /** Eases the mouse to a point over `ms`, emitting a move every frame. */
  async moveTo(x: number, y: number, ms = 700) {
    const from = { x: this.x, y: this.y }
    const start = Date.now()
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / ms)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      this.x = from.x + (x - from.x) * e
      this.y = from.y + (y - from.y) * e
      await this.page.mouse.move(this.x, this.y)
      if (t === 1) break
      await this.page.waitForTimeout(8)
    }
  }

  async to(target: Locator, ms = 700, offset = { x: 0.5, y: 0.5 }) {
    const box = await target.boundingBox()
    if (!box) throw new Error(`No box for ${target}`)
    await this.moveTo(
      box.x + box.width * offset.x,
      box.y + box.height * offset.y,
      ms
    )
  }

  async click(target: Locator, ms = 700) {
    await this.to(target, ms)
    await this.page.waitForTimeout(140)
    await this.page.mouse.down()
    await this.page.waitForTimeout(90)
    await this.page.mouse.up()
  }

  async drag(
    from: Locator,
    to: Locator,
    ms = 1100,
    dropAt = { x: 0.5, y: 0.5 }
  ) {
    await this.to(from, 700, { x: 0.3, y: 0.5 })
    await this.page.waitForTimeout(160)
    await this.page.mouse.down()
    await this.page.waitForTimeout(160)
    await this.to(to, ms, dropAt)
    await this.page.waitForTimeout(220)
    await this.page.mouse.up()
  }
}

// ─── Recording ───────────────────────────────────────────────────────────

interface Clip {
  name: string
  headline: string
  sub: string
  act: (page: Page, pointer: Pointer) => Promise<void>
  /** Off-camera clean-up after the take. */
  reset?: (page: Page) => Promise<void>
}

async function record(page: Page, clip: Clip, pointer: Pointer) {
  const dir = path.join(WORK, clip.name)
  fs.mkdirSync(dir, { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  const frames: { file: string; at: number }[] = []
  cdp.on("Page.screencastFrame", async (frame) => {
    const file = path.join(dir, `${String(frames.length).padStart(5, "0")}.jpg`)
    fs.writeFileSync(file, Buffer.from(frame.data, "base64"))
    frames.push({ file, at: frame.metadata.timestamp ?? Date.now() / 1000 })
    await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId })
  })
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: 1920,
    maxHeight: 1200,
  })
  await page.waitForTimeout(300)
  await clip.act(page, pointer)
  const end = Date.now() / 1000
  await cdp.send("Page.stopScreencast")
  await page.waitForTimeout(200)
  await cdp.detach()

  // Frames arrive only when the page changes, so each one lasts until the next.
  const list = frames
    .map((frame, i) => {
      const next = i + 1 < frames.length ? frames[i + 1].at : end
      return `file '${frame.file}'\nduration ${Math.max(0.001, next - frame.at).toFixed(4)}`
    })
    .join("\n")
  fs.writeFileSync(
    path.join(dir, "frames.txt"),
    `${list}\nfile '${frames[frames.length - 1].file}'\n`
  )
  return end - frames[0].at
}

// ─── Composition ─────────────────────────────────────────────────────────

const VIDEO_CSS = `
  .caption { position: absolute; left: 0; right: 0; top: 44px; text-align: center; }
  .caption .index { font-family: Fraunces, serif; font-style: italic; font-size: 22px; color: var(--primary); }
  .caption h1 { margin-top: 6px; font-size: 62px; line-height: 1.08; }
  .caption p { margin-top: 12px; font-size: 24px; color: var(--muted); }
  .bar { height: ${BAR}px; gap: 8px; padding: 0 16px; }
  .bar i { width: 12px; height: 12px; }
  .bar span { font-size: 14px; width: 300px; padding: 5px 12px; }
  .card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .card .eyebrow { font-size: 18px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .card h1 { line-height: 1.0; }
  .card p { font-size: 30px; line-height: 1.5; color: var(--muted); }
  .chips { display: flex; gap: 12px; margin-top: 40px; }
  .chips span { font-size: 20px; padding: 10px 20px; border-radius: 999px; border: 1px solid var(--hairline); background: oklch(1 0 0 / 4%); }
  .url { margin-top: 36px; font-size: 30px; color: var(--primary); letter-spacing: 0.01em; }
`

function sceneBackdrop(index: number, headline: string, sub: string) {
  return `<div class="caption">
      <div class="index">${String(index).padStart(2, "0")} —</div>
      <h1 class="display">${headline}</h1>
      <p>${sub}</p>
    </div>${browserWindow(null, WINDOW)}`
}

const encode = [
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "14",
  "-pix_fmt",
  "yuv420p",
  "-r",
  String(FPS),
]

function stillSegment(png: string, seconds: number, out: string) {
  run([
    "-loop",
    "1",
    "-t",
    String(seconds),
    "-i",
    png,
    "-vf",
    `fps=${FPS},format=yuv420p`,
    ...encode,
    out,
  ])
}

function sceneSegment(
  backdrop: string,
  frames: string,
  seconds: number,
  out: string
) {
  run([
    "-loop",
    "1",
    "-i",
    backdrop,
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    frames,
    "-filter_complex",
    `[1:v]fps=${FPS},scale=${APP_BOX.w}:${APP_BOX.h}:flags=lanczos[app];` +
      `[0:v][app]overlay=${APP_BOX.x}:${APP_BOX.y}:shortest=1,format=yuv420p`,
    "-t",
    seconds.toFixed(3),
    ...encode,
    out,
  ])
}

function joinWithCrossfades(segments: { file: string; seconds: number }[]) {
  const inputs = segments.flatMap((s) => ["-i", s.file])
  const filters = segments.map((_, i) => `[${i}:v]settb=AVTB,fps=${FPS}[s${i}]`)
  let last = "s0"
  let offset = 0
  segments.slice(1).forEach((_, i) => {
    offset += segments[i].seconds - FADE
    const label = `x${i + 1}`
    filters.push(
      `[${last}][s${i + 1}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[${label}]`
    )
    last = label
  })
  run([
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${last}]`,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-movflags",
    "+faststart",
    FILE,
  ])
}

// ─── The story ───────────────────────────────────────────────────────────

const card = (page: Page, title: string) =>
  page.locator('[data-testid="bookmark-card"]').filter({ hasText: title })
const menuItem = (page: Page, name: string) =>
  page
    .locator('[role^="menuitem"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
const dialog = (page: Page) => page.locator('[role="dialog"]').first()

const CLIPS: Clip[] = [
  {
    name: "dashboard",
    headline: "Your bookmarks, <em>as a beautiful new tab</em>",
    sub: "Every folder becomes a card. Local and private: no account, no tracking.",
    act: async (page, pointer) => {
      await page.waitForTimeout(500)
      await pointer.to(
        card(page, "News & Reading").getByText("Hacker News"),
        1000
      )
      await page.waitForTimeout(700)
      await pointer.to(card(page, "Social").locator("a").first(), 800)
      await page.waitForTimeout(900)
      await pointer.to(card(page, "Entertainment").getByText("Spotify"), 900)
      await page.waitForTimeout(500)
      for (let i = 0; i < 24; i++) {
        await page.mouse.wheel(0, 16)
        await page.waitForTimeout(16)
      }
      await page.waitForTimeout(900)
    },
    reset: async (page) => {
      await page.mouse.wheel(0, -2000)
      await page.waitForTimeout(400)
    },
  },
  {
    name: "sources",
    headline: "Browser or Markdown vault. <em>Never mixed.</em>",
    sub: "Switch sources from the top of the dashboard. Vaults are plain files you own.",
    act: async (page, pointer) => {
      const switcher = page.getByRole("button", { name: /Bookmark source/ })
      await pointer.click(switcher, 900)
      await page.waitForTimeout(700)
      await pointer.click(menuItem(page, "reading"), 600)
      await page.waitForTimeout(1600)
      await pointer.click(
        page.getByRole("button", { name: /Bookmark source/ }),
        600
      )
      await page.waitForTimeout(500)
      await pointer.click(menuItem(page, "Browser bookmarks"), 600)
      await page.waitForTimeout(1200)
    },
  },
  {
    name: "search",
    headline: "Find any bookmark <em>in a keystroke</em>",
    sub: "Just start typing on the new tab, or type bb in the address bar.",
    act: async (page) => {
      await page.waitForTimeout(600)
      await page.keyboard.type("git", { delay: 190 })
      await page.waitForTimeout(900)
      for (let i = 0; i < 2; i++) {
        await page.keyboard.press("ArrowDown")
        await page.waitForTimeout(420)
      }
      await page.waitForTimeout(900)
    },
    reset: async (page) => {
      await page.keyboard.press("Escape")
    },
  },
  {
    name: "drag",
    headline: "Drag bookmarks <em>where they belong</em>",
    sub: "Move bookmarks between folders and reorder them, right on the dashboard.",
    act: async (page, pointer) => {
      await page.waitForTimeout(400)
      await pointer.drag(
        card(page, "News & Reading").getByText("Hacker News"),
        card(page, "Dev Tools").getByText("Stack Overflow"),
        1300
      )
      await page.waitForTimeout(900)
      await pointer.moveTo(pointer.x + 180, pointer.y + 90, 700)
      await page.waitForTimeout(600)
    },
  },
  {
    name: "organizer",
    headline: "A real organizer, <em>right in the new tab</em>",
    sub: "Drag, reorder, rename, create and delete across your whole bookmark tree.",
    act: async (page, pointer) => {
      await pointer.click(
        page.getByRole("button", { name: "Bookmark tree" }),
        900
      )
      await page.waitForTimeout(1000)
      const handles = page.getByLabel("Drag item")
      await pointer.drag(handles.nth(1), handles.nth(4), 1200, {
        x: 0.5,
        y: 0.85,
      })
      await page.waitForTimeout(900)
      await pointer.click(page.getByText("Folders Only"), 800)
      await page.waitForTimeout(1300)
    },
    reset: async (page) => {
      await page.keyboard.press("Escape")
      await page.waitForTimeout(500)
    },
  },
  {
    name: "themes",
    headline: "Ten themes, <em>light and dark</em>",
    sub: "Pick a theme and a light or dark mode. It applies to every source.",
    act: async (page, pointer) => {
      await pointer.click(page.getByRole("button", { name: "Settings" }), 800)
      await page.waitForTimeout(700)
      await pointer.click(
        dialog(page).getByText("Appearance", { exact: true }),
        700
      )
      await page.waitForTimeout(600)
      for (const theme of ["Bubblegum", "Claude", "Claymorphism"]) {
        await pointer.click(dialog(page).getByText(theme, { exact: true }), 600)
        await page.waitForTimeout(750)
      }
      await pointer.click(dialog(page).getByText("Light", { exact: true }), 700)
      await page.waitForTimeout(900)
      await pointer.click(
        dialog(page).getByRole("button", { name: "Close" }),
        700
      )
      // Closing hands focus back to the Settings button, which would sit
      // there with a focus ring and tooltip for the rest of the take.
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur()
      )
      await pointer.moveTo(900, 40, 900)
      await page.waitForTimeout(1300)
    },
  },
]

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: APP_W, height: APP_H },
      deviceScaleFactor: 2,
    })
    await context.addInitScript(() => localStorage.setItem("theme", "dark"))
    await context.addInitScript({ content: CURSOR_SCRIPT })
    const page = await context.newPage()
    const pointer = new Pointer(page)
    await page.goto(APP)
    await page.waitForLoadState("networkidle")

    // Off camera: the brand theme through the real settings, and every
    // favicon both sources need, so no take shows an icon loading.
    await page.getByRole("button", { name: "Settings" }).click()
    await dialog(page).getByText("Appearance", { exact: true }).click()
    await dialog(page).getByText("Amber Minimal", { exact: true }).click()
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: /Bookmark source/ }).click()
    await menuItem(page, "reading").click()
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1200)
    await page.getByRole("button", { name: /Bookmark source/ }).click()
    await menuItem(page, "Browser bookmarks").click()
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(2000)

    const segments: { file: string; seconds: number }[] = []

    await render(
      browser,
      path.join(WORK, "intro.png"),
      { width: W, height: H },
      `<div class="card">
        <div class="eyebrow">New tab extension · Chrome · Firefox · Safari</div>
        <h1 class="display" style="font-size:150px;margin-top:28px">Bookmarks,<br><em>but better</em></h1>
        <p style="margin-top:32px">Your bookmarks as a beautiful new tab.</p>
      </div>`,
      VIDEO_CSS
    )
    stillSegment(
      path.join(WORK, "intro.png"),
      2.6,
      path.join(WORK, "00-intro.mp4")
    )
    segments.push({ file: path.join(WORK, "00-intro.mp4"), seconds: 2.6 })

    for (const [i, clip] of CLIPS.entries()) {
      await pointer.park()
      await page.waitForTimeout(500)
      const seconds = await record(page, clip, pointer)
      await clip.reset?.(page)
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur()
      )

      const backdrop = path.join(WORK, `${clip.name}.png`)
      await render(
        browser,
        backdrop,
        { width: W, height: H },
        sceneBackdrop(i + 1, clip.headline, clip.sub),
        VIDEO_CSS
      )
      const file = path.join(
        WORK,
        `${String(i + 1).padStart(2, "0")}-${clip.name}.mp4`
      )
      sceneSegment(
        backdrop,
        path.join(WORK, clip.name, "frames.txt"),
        seconds,
        file
      )
      segments.push({ file, seconds })
      console.log(`✓ ${clip.name} (${seconds.toFixed(1)}s)`)
    }

    await render(
      browser,
      path.join(WORK, "outro.png"),
      { width: W, height: H },
      `<div class="card">
        <h1 class="display" style="font-size:120px">Bookmarks, <em>but better</em></h1>
        <p style="margin-top:28px">Local, private, no account. Free and open source.</p>
        <div class="chips"><span>Chrome</span><span>Firefox</span><span>Safari</span></div>
        <div class="url">bookmarks.but-better.dev</div>
      </div>`,
      VIDEO_CSS
    )
    stillSegment(
      path.join(WORK, "outro.png"),
      4,
      path.join(WORK, "99-outro.mp4")
    )
    segments.push({ file: path.join(WORK, "99-outro.mp4"), seconds: 4 })

    joinWithCrossfades(segments)
    const total =
      segments.reduce((sum, s) => sum + s.seconds, 0) -
      FADE * (segments.length - 1)
    console.log(`✓ ${path.relative(ROOT, FILE)} (${total.toFixed(1)}s)`)
  } finally {
    await browser.close()
  }
  if (!process.env.KEEP_WORK) fs.rmSync(WORK, { recursive: true, force: true })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
