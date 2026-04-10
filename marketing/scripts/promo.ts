import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PROMO_CONFIG } from './promo.config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUT = path.resolve(__dirname, '../output')
const MANIFEST_PATH = path.resolve(__dirname, '../../public/manifest.json')
const LOGO_PATH = path.resolve(__dirname, '../../public/logo-dark.svg')

interface Manifest { name: string; description: string }

function inlineLogo(svgContent: string, size: number): string {
  return svgContent.replace('<svg', `<svg width="${size}" height="${size}"`)
}

function dotsHTML(): string {
  return PROMO_CONFIG.themeColors
    .map(c => `<span class="dot" style="background:${c}"></span>`)
    .join('')
}

function buildSmallHTML(logoSvg: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 440px; height: 280px;
    background: #0a0a0a;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: 36px 36px 30px;
    overflow: hidden;
  }
  .label { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
  .label svg { flex-shrink: 0; }
  .label-text {
    font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
    color: #6b7280; text-transform: uppercase;
  }
  h1 { font-size: 36px; font-weight: 800; color: #fff; line-height: 1.08; margin-bottom: 10px; }
  h1 em { font-style: italic; color: #e5e7eb; }
  .desc { font-size: 12px; color: #6b7280; line-height: 1.55; margin-bottom: 22px; }
  .dots-row { display: flex; align-items: center; gap: 5px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .dots-label { font-size: 10px; color: #4b5563; margin-left: 8px; }
</style>
</head>
<body>
  <div class="label">
    ${inlineLogo(logoSvg, 20)}
    <span class="label-text">${PROMO_CONFIG.tagline}</span>
  </div>
  <h1>${PROMO_CONFIG.headlineMain}<br><em>${PROMO_CONFIG.headlineSub}</em></h1>
  <p class="desc">${PROMO_CONFIG.subtitleSmall}</p>
  <div class="dots-row">
    ${dotsHTML()}
    <span class="dots-label">${PROMO_CONFIG.themingLabel}</span>
  </div>
</body>
</html>`
}

function buildMarqueeHTML(logoSvg: string, appBase64: string): string {
  const badges = PROMO_CONFIG.features
    .map(f => `<span class="badge">${f}</span>`)
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1400px; height: 560px;
    background: #0a0a0a;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    display: flex; overflow: hidden;
  }
  .left {
    flex: 0 0 490px;
    display: flex; flex-direction: column; justify-content: center;
    padding: 48px 44px 44px 56px;
  }
  .label { display: flex; align-items: center; gap: 9px; margin-bottom: 22px; }
  .label svg { flex-shrink: 0; }
  .label-text {
    font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
    color: #6b7280; text-transform: uppercase;
  }
  h1 { font-size: 52px; font-weight: 800; color: #fff; line-height: 1.05; margin-bottom: 14px; }
  h1 em { font-style: italic; }
  .desc { font-size: 14px; color: #6b7280; line-height: 1.6; margin-bottom: 22px; }
  .badges { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 22px; }
  .badge {
    font-size: 11px; font-weight: 500; color: #9ca3af;
    border: 1px solid #374151; border-radius: 4px;
    padding: 4px 10px; background: #111827;
  }
  .dots-row { display: flex; align-items: center; gap: 5px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
  .dots-label { font-size: 10px; color: #4b5563; margin-left: 8px; }
  .right {
    flex: 1;
    display: flex; align-items: center;
    padding: 28px 28px 28px 16px;
  }
  .app-frame {
    width: 100%; height: 100%;
    border-radius: 8px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.07);
  }
  .app-frame img {
    width: 100%; height: 100%;
    object-fit: cover; object-position: top left; display: block;
  }
</style>
</head>
<body>
  <div class="left">
    <div class="label">
      ${inlineLogo(logoSvg, 22)}
      <span class="label-text">${PROMO_CONFIG.tagline}</span>
    </div>
    <h1>${PROMO_CONFIG.headlineMain}<br><em>${PROMO_CONFIG.headlineSub}</em></h1>
    <p class="desc">${PROMO_CONFIG.subtitleMarquee.replace('\n', '<br>')}</p>
    <div class="badges">${badges}</div>
    <div class="dots-row">
      ${dotsHTML()}
      <span class="dots-label">${PROMO_CONFIG.themingLabel}</span>
    </div>
  </div>
  <div class="right">
    <div class="app-frame">
      <img src="data:image/png;base64,${appBase64}" alt="App screenshot">
    </div>
  </div>
</body>
</html>`
}

async function run() {
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'))
  void manifest // read for future use (e.g. dynamic copy overrides)
  const logoSvg = fs.readFileSync(LOGO_PATH, 'utf-8')

  const browser = await chromium.launch()
  const context = await browser.newContext()

  try {
    // Capture live app screenshot for the marquee right-side panel
    const appPage = await context.newPage()
    await appPage.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await appPage.setViewportSize({ width: 1180, height: 504 })
    await appPage.goto('http://localhost:5173/?screenshot=true')
    await appPage.waitForLoadState('networkidle')
    await appPage.waitForTimeout(500)
    const appBuffer = await appPage.screenshot({ type: 'png' })
    const appBase64 = appBuffer.toString('base64')
    await appPage.close()

    // Small promo tile (440×280)
    const smallPage = await context.newPage()
    await smallPage.setViewportSize({ width: 440, height: 280 })
    await smallPage.setContent(buildSmallHTML(logoSvg), { waitUntil: 'networkidle' })
    await smallPage.evaluate(() => document.fonts.ready)
    await smallPage.screenshot({ path: `${OUT}/promo-small.png` })
    await smallPage.close()

    // Marquee promo tile (1400×560)
    const marqueePage = await context.newPage()
    await marqueePage.setViewportSize({ width: 1400, height: 560 })
    await marqueePage.setContent(buildMarqueeHTML(logoSvg, appBase64), { waitUntil: 'networkidle' })
    await marqueePage.evaluate(() => document.fonts.ready)
    await marqueePage.screenshot({ path: `${OUT}/promo-marquee.png` })
    await marqueePage.close()
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  console.log('✓ promo-small.png and promo-marquee.png written to docs/screenshots/')
}

run().catch(err => { console.error(err); process.exit(1) })
