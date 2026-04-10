import { test } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUT = path.resolve(__dirname, '../../docs/screenshots')

test('capture store screenshots and promo tiles', async ({ page }) => {
  // ─── 01-dashboard.png (1280×800) ──────────────────────────────────
  await test.step('01-dashboard', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/?screenshot=true')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/01-dashboard.png` })
  })

  // ─── 02-hover-card.png (1280×800) ─────────────────────────────────
  await test.step('02-hover-card', async () => {
    await page.goto('/?screenshot=true')
    await page.waitForLoadState('networkidle')
    await page.locator('[data-testid="bookmark-card"]').first().hover()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/02-hover-card.png` })
  })

  // ─── 03-organizer.png (1280×800) ──────────────────────────────────
  await test.step('03-organizer', async () => {
    await page.goto('/?screenshot=true')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Bookmark Organizer' }).click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/03-organizer.png` })
  })

  // ─── 04-themes.png — cyberpunk theme (1280×800) ───────────────────
  await test.step('04-themes', async () => {
    await page.goto('/?screenshot=true')
    await page.waitForLoadState('networkidle')
    await page.evaluate(() =>
      document.documentElement.setAttribute('data-color-theme', 'cyberpunk')
    )
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/04-themes.png` })
  })

  // ─── 05-settings.png (1280×800) ───────────────────────────────────
  await test.step('05-settings', async () => {
    await page.goto('/?screenshot=true')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForSelector('[role="dialog"]', { timeout: 5_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/05-settings.png` })
  })

  // ─── promo-small.png (440×280) ────────────────────────────────────
  await test.step('promo-small', async () => {
    await page.setViewportSize({ width: 440, height: 280 })
    await page.goto('/?screenshot=true')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/promo-small.png` })
  })

  // ─── promo-marquee.png (1400×560) ─────────────────────────────────
  await test.step('promo-marquee', async () => {
    await page.setViewportSize({ width: 1400, height: 560 })
    await page.goto('/?screenshot=true')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/promo-marquee.png` })
  })
})
