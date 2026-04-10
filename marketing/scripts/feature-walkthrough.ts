import { chromium } from '@playwright/test'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUT = path.resolve(__dirname, '../output/videos')
const TMP = path.join(OUT, 'tmp-video')

async function run() {
  fs.mkdirSync(TMP, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: TMP, size: { width: 1280, height: 800 } },
  })
  await context.addInitScript(() => localStorage.setItem('theme', 'dark'))
  const page = await context.newPage()

  try {
    // 1. Dashboard loads with bookmarks and favicons visible
    await page.goto('http://localhost:5173/?screenshot=true')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // 2. Hover a bookmark link to show row highlight + HoverCard popup
    await page.locator('[data-testid="bookmark-card"] a').first().hover()
    await page.waitForSelector('[data-slot="hover-card-content"]', { timeout: 3_000 })
    await page.waitForTimeout(800) // hold hover state visibly in the video

    // 3. Open organizer, show tree, close
    await page.getByRole('button', { name: 'Bookmark Organizer' }).click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5_000 })
    await page.waitForTimeout(2500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)

    // 4. Open settings
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5_000 })
    await page.waitForTimeout(2000)
  } finally {
    await context.close().catch(() => {}) // triggers .webm save
    await browser.close().catch(() => {})
  }

  const files = fs.readdirSync(TMP)
  const webm = files.find(f => f.endsWith('.webm'))
  if (!webm) throw new Error('No .webm file found — video recording failed')

  const webmPath = path.join(TMP, webm)

  const ffmpeg = (await import('ffmpeg-static')).default
  if (!ffmpeg) throw new Error('ffmpeg-static returned null — no bundled ffmpeg binary for this platform')

  try {
    // Convert to MP4
    execSync(
      `"${ffmpeg}" -i "${webmPath}" -c:v libx264 -pix_fmt yuv420p "${OUT}/feature-walkthrough.mp4" -y`,
      { stdio: 'inherit' }
    )

    // Convert to GIF (12fps, width 1280)
    execSync(
      `"${ffmpeg}" -i "${OUT}/feature-walkthrough.mp4" -vf "fps=12,scale=1280:-1:flags=lanczos" -loop 0 "${OUT}/feature-walkthrough.gif" -y`,
      { stdio: 'inherit' }
    )
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true })
  }
  console.log('✓ feature-walkthrough.mp4 and .gif written to docs/screenshots/')
}

run().catch(err => { console.error(err); process.exit(1) })
