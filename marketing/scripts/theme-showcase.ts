import { chromium } from '@playwright/test'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUT = path.resolve(__dirname, '../output/videos')
const TMP = path.join(OUT, 'tmp-themes')

const THEMES = [
  'default',
  'amber-minimal',
  'bubblegum',
  'caffeine',
  'claude',
  'claymorphism',
  'cyberpunk',
  'solar-dusk',
  't3-chat',
  'vintage-paper',
] as const

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
    await page.goto('http://localhost:5173/?screenshot=true')
    await page.waitForLoadState('networkidle')

    for (const theme of THEMES) {
      await page.evaluate((t) => {
        if (t === 'default') {
          document.documentElement.removeAttribute('data-color-theme')
        } else {
          document.documentElement.setAttribute('data-color-theme', t)
        }
      }, theme)
      await page.waitForTimeout(1500) // hold each theme for 1.5s
    }

    await page.waitForTimeout(500) // trailing pause
  } finally {
    await context.close().catch(() => {})
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
      `"${ffmpeg}" -i "${webmPath}" -c:v libx264 -pix_fmt yuv420p "${OUT}/theme-showcase.mp4" -y`,
      { stdio: 'inherit' }
    )

    // Convert to GIF (10fps — lower for smaller file, themes are slow-paced)
    execSync(
      `"${ffmpeg}" -i "${OUT}/theme-showcase.mp4" -vf "fps=10,scale=1280:-1:flags=lanczos" -loop 0 "${OUT}/theme-showcase.gif" -y`,
      { stdio: 'inherit' }
    )
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true })
  }

  console.log('✓ theme-showcase.mp4 and .gif written to docs/screenshots/')
}

run().catch(err => { console.error(err); process.exit(1) })
