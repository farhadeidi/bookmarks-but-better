# Screenshot & Video Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate all Chrome Web Store asset production — 5 ordered screenshots, 2 promo tiles, a feature walkthrough video/GIF, and a theme showcase video/GIF — runnable with `bun run assets`.

**Architecture:** All pipelines are Playwright-based, running against the Vite dev server in standalone mode with its default seed data. A `getScreenshotMode` hook reads `?screenshot=` query params to suppress dev-only UI and control the onboarding wizard per capture. Videos are produced via Playwright's built-in `recordVideo`, then converted to MP4 + GIF using `ffmpeg-static` (provides a cross-platform ffmpeg binary as an npm package). Remotion was considered for the theme showcase but deferred: Tailwind CSS v4 (CSS-first) has unverified Remotion plugin support, and Playwright recording of the real app achieves equivalent visual quality.

**Tech Stack:** `@playwright/test` (screenshots + video recording), `ffmpeg-static` (ffmpeg binary via npm — no system install needed), `tsx` (run TypeScript scripts directly), `vitest` (unit tests for hook)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/hooks/use-screenshot-mode.ts` | Create | Read `?screenshot=` param, return typed mode |
| `src/hooks/use-screenshot-mode.test.ts` | Create | Unit tests |
| `src/App.tsx` | Modify | Wire hook to dev button + onboarding bootstrap |
| `src/features/bookmark-card/bookmark-card.tsx` | Modify | Add `data-testid="bookmark-card"` for stable Playwright selector |
| `scripts/screenshots/playwright.config.ts` | Create | Playwright config: webServer auto-start, baseURL |
| `scripts/screenshots/capture.spec.ts` | Create | 5 store screenshots + 2 promo tiles |
| `scripts/screenshots/feature-walkthrough.ts` | Create | Interaction recording → MP4 + GIF |
| `scripts/screenshots/theme-showcase.ts` | Create | Theme cycling recording → MP4 + GIF |
| `package.json` | Modify | devDeps + npm scripts |
| `.gitignore` | Modify | Ignore tmp frame/video dirs |

---

## Task 1: Install devDependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
bun add -D @playwright/test ffmpeg-static tsx
bun add -D @types/ffmpeg-static
```

- [ ] **Step 2: Install Playwright's Chromium browser**

```bash
bunx playwright install chromium
```

Expected output: `✓ chromium downloaded` (or "Chromium ... is already installed")

- [ ] **Step 3: Verify**

```bash
bunx playwright --version && bunx tsx --version
```

Expected: both print version numbers without errors.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add playwright, remotion/renderer, tsx as devDependencies"
```

---

## Task 2: `getScreenshotMode` hook

**Files:**
- Create: `src/hooks/use-screenshot-mode.ts`
- Create: `src/hooks/use-screenshot-mode.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/use-screenshot-mode.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getScreenshotMode } from './use-screenshot-mode'

afterEach(() => vi.unstubAllGlobals())

describe('getScreenshotMode', () => {
  it('returns false when no query param is present', () => {
    vi.stubGlobal('location', { search: '' })
    expect(getScreenshotMode()).toBe(false)
  })

  it('returns "default" for ?screenshot=true', () => {
    vi.stubGlobal('location', { search: '?screenshot=true' })
    expect(getScreenshotMode()).toBe('default')
  })

  it('returns "onboarding" for ?screenshot=onboarding', () => {
    vi.stubGlobal('location', { search: '?screenshot=onboarding' })
    expect(getScreenshotMode()).toBe('onboarding')
  })

  it('returns false for an unknown param value', () => {
    vi.stubGlobal('location', { search: '?screenshot=foobar' })
    expect(getScreenshotMode()).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun run test -- use-screenshot-mode
```

Expected: 4 failures — `getScreenshotMode` not found.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/use-screenshot-mode.ts`:

```ts
export type ScreenshotMode = false | 'default' | 'onboarding'

export function getScreenshotMode(): ScreenshotMode {
  const param = new URLSearchParams(location.search).get('screenshot')
  if (param === 'onboarding') return 'onboarding'
  if (param === 'true') return 'default'
  return false
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun run test -- use-screenshot-mode
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-screenshot-mode.ts src/hooks/use-screenshot-mode.test.ts
git commit -m "feat: add getScreenshotMode hook"
```

---

## Task 3: Wire `getScreenshotMode` into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import**

After the last import line in `src/App.tsx` (line 42), add:

```ts
import { getScreenshotMode } from "@/hooks/use-screenshot-mode"
```

- [ ] **Step 2: Call the hook inside `App()`**

Inside `export function App()` at `src/App.tsx:68`, after the existing store hooks (around line 78), add:

```ts
const screenshotMode = getScreenshotMode()
```

- [ ] **Step 3: Update the bootstrap `useEffect` to respect screenshot mode**

The current bootstrap at `src/App.tsx:92–105`:

```ts
React.useEffect(() => {
  async function bootstrap() {
    const adapter = await detectAdapter()
    await Promise.all([initBookmarks(adapter), initPreferences(adapter)])
    const onboardingCompleted = await adapter.storage.get<boolean>(
      "onboardingCompleted"
    )
    if (!onboardingCompleted) {
      setShowOnboarding(true)
    }
    setOnboardingChecked(true)
  }
  bootstrap()
}, [initBookmarks, initPreferences])
```

Replace with:

```ts
React.useEffect(() => {
  async function bootstrap() {
    const adapter = await detectAdapter()
    await Promise.all([initBookmarks(adapter), initPreferences(adapter)])
    if (screenshotMode === 'onboarding') {
      setShowOnboarding(true)
    } else if (!screenshotMode) {
      const onboardingCompleted = await adapter.storage.get<boolean>(
        "onboardingCompleted"
      )
      if (!onboardingCompleted) {
        setShowOnboarding(true)
      }
    }
    // screenshotMode === 'default': showOnboarding stays false (suppressed)
    setOnboardingChecked(true)
  }
  bootstrap()
}, [initBookmarks, initPreferences, screenshotMode])
```

- [ ] **Step 4: Update the dev button condition**

At `src/App.tsx:256`, change:

```tsx
{import.meta.env.DEV && (
```

to:

```tsx
{import.meta.env.DEV && !screenshotMode && (
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: suppress dev UI and wizard when screenshot mode is active"
```

---

## Task 4: Add `data-testid` to `BookmarkCard`

**Files:**
- Modify: `src/features/bookmark-card/bookmark-card.tsx:152`

- [ ] **Step 1: Add the attribute**

At `src/features/bookmark-card/bookmark-card.tsx:152`, change the root `<div>`:

Before:
```tsx
<div
  ref={dropRef as React.RefObject<HTMLDivElement>}
  className={cn(
    "flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow",
    nested && "ring-border/50",
    isOver && "shadow-md ring-2 ring-primary/50"
  )}
>
```

After:
```tsx
<div
  ref={dropRef as React.RefObject<HTMLDivElement>}
  data-testid="bookmark-card"
  className={cn(
    "flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow",
    nested && "ring-border/50",
    isOver && "shadow-md ring-2 ring-primary/50"
  )}
>
```

- [ ] **Step 2: Commit**

```bash
git add src/features/bookmark-card/bookmark-card.tsx
git commit -m "chore: add data-testid to BookmarkCard for screenshot selectors"
```

---

## Task 5: Playwright config + static screenshot pipeline

**Files:**
- Create: `scripts/screenshots/playwright.config.ts`
- Create: `scripts/screenshots/capture.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the Playwright config**

Create `scripts/screenshots/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
```

- [ ] **Step 2: Create the capture script**

Create `scripts/screenshots/capture.spec.ts`:

```ts
import { test } from '@playwright/test'
import path from 'path'

const OUT = path.resolve('docs/screenshots')

test('capture store screenshots and promo tiles', async ({ page }) => {
  // ─── 01-dashboard.png (1280×800) ──────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/?screenshot=true')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/01-dashboard.png` })

  // ─── 02-hover-card.png (1280×800) ─────────────────────────────────
  await page.goto('/?screenshot=true')
  await page.waitForLoadState('networkidle')
  await page.locator('[data-testid="bookmark-card"]').first().hover()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/02-hover-card.png` })

  // ─── 03-organizer.png (1280×800) ──────────────────────────────────
  await page.goto('/?screenshot=true')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Bookmark Organizer' }).click()
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/03-organizer.png` })

  // ─── 04-themes.png — cyberpunk theme (1280×800) ───────────────────
  await page.goto('/?screenshot=true')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() =>
    document.documentElement.setAttribute('data-color-theme', 'cyberpunk')
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/04-themes.png` })

  // ─── 05-settings.png (1280×800) ───────────────────────────────────
  await page.goto('/?screenshot=true')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/05-settings.png` })

  // ─── promo-small.png (440×280) ────────────────────────────────────
  await page.setViewportSize({ width: 440, height: 280 })
  await page.goto('/?screenshot=true')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/promo-small.png` })

  // ─── promo-marquee.png (1400×560) ─────────────────────────────────
  await page.setViewportSize({ width: 1400, height: 560 })
  await page.goto('/?screenshot=true')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/promo-marquee.png` })
})
```

- [ ] **Step 3: Add npm script to `package.json`**

In the `"scripts"` section:

```json
"screenshots": "playwright test scripts/screenshots/capture.spec.ts --config scripts/screenshots/playwright.config.ts"
```

- [ ] **Step 4: Run it**

```bash
bun run screenshots
```

Expected: Playwright starts the dev server, runs 1 test, writes 7 PNG files to `docs/screenshots/`. Output ends with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/screenshots/ package.json docs/screenshots/*.png
git commit -m "feat: add Playwright static screenshot and promo tile pipeline"
```

---

## Task 6: Feature walkthrough video

**Files:**
- Create: `scripts/screenshots/feature-walkthrough.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the script**

Create `scripts/screenshots/feature-walkthrough.ts`:

```ts
import { chromium } from '@playwright/test'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const OUT = path.resolve('docs/screenshots')
const TMP = path.join(OUT, 'tmp-video')

async function run() {
  fs.mkdirSync(TMP, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: TMP, size: { width: 1280, height: 800 } },
  })
  const page = await context.newPage()

  // 1. Dashboard loads with bookmarks and favicons visible
  await page.goto('http://localhost:5173/?screenshot=true')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  // 2. Hover a bookmark card
  await page.locator('[data-testid="bookmark-card"]').first().hover()
  await page.waitForTimeout(1500)

  // 3. Open organizer, show tree, close
  await page.getByRole('button', { name: 'Bookmark Organizer' }).click()
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(2500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  // 4. Open settings
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.waitForSelector('[role="dialog"]')
  await page.waitForTimeout(2000)

  await context.close() // triggers .webm save
  await browser.close()

  const files = fs.readdirSync(TMP)
  const webm = files.find(f => f.endsWith('.webm'))
  if (!webm) throw new Error('No .webm file found — video recording failed')

  const webmPath = path.join(TMP, webm)

  // ffmpeg-static provides the binary path
  const ffmpeg = (await import('ffmpeg-static')).default as string

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

  fs.rmSync(TMP, { recursive: true, force: true })
  console.log('✓ feature-walkthrough.mp4 and .gif written to docs/screenshots/')
}

run().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Add npm script to `package.json`**

```json
"video:features": "tsx scripts/screenshots/feature-walkthrough.ts"
```

- [ ] **Step 3: Start the dev server then run the script**

Terminal 1:
```bash
bun run dev
```

Terminal 2:
```bash
bun run video:features
```

Expected: `docs/screenshots/feature-walkthrough.mp4` (~25s, 1280×800) and `feature-walkthrough.gif` created.

- [ ] **Step 4: Commit**

```bash
git add scripts/screenshots/feature-walkthrough.ts package.json
git add docs/screenshots/feature-walkthrough.mp4 docs/screenshots/feature-walkthrough.gif
git commit -m "feat: add feature walkthrough video pipeline"
```

---

## Task 7: Theme showcase video

**Files:**
- Create: `scripts/screenshots/theme-showcase.ts`
- Modify: `package.json`

Strategy: Playwright records the real app while we cycle through all 10 themes using `page.evaluate()`. The app's existing CSS transitions apply naturally. Then convert the `.webm` to MP4 + GIF.

- [ ] **Step 1: Create the script**

Create `scripts/screenshots/theme-showcase.ts`:

```ts
import { chromium } from '@playwright/test'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const OUT = path.resolve('docs/screenshots')
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
  const page = await context.newPage()

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
  await context.close() // triggers .webm save
  await browser.close()

  const files = fs.readdirSync(TMP)
  const webm = files.find(f => f.endsWith('.webm'))
  if (!webm) throw new Error('No .webm file found — video recording failed')

  const webmPath = path.join(TMP, webm)

  const ffmpeg = (await import('ffmpeg-static')).default as string

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

  fs.rmSync(TMP, { recursive: true, force: true })
  console.log('✓ theme-showcase.mp4 and .gif written to docs/screenshots/')
}

run().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Add npm script to `package.json`**

```json
"video:themes": "tsx scripts/screenshots/theme-showcase.ts"
```

- [ ] **Step 3: Start the dev server then run the script**

Terminal 1:
```bash
bun run dev
```

Terminal 2:
```bash
bun run video:themes
```

Expected: `docs/screenshots/theme-showcase.mp4` (~20s cycling 10 themes) and `theme-showcase.gif` created.

- [ ] **Step 4: Commit**

```bash
git add scripts/screenshots/theme-showcase.ts package.json
git add docs/screenshots/theme-showcase.mp4 docs/screenshots/theme-showcase.gif
git commit -m "feat: add theme showcase video pipeline"
```

---

## Task 8: Master script + `.gitignore` cleanup

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add master `assets` script**

In `package.json` scripts:

```json
"assets": "bun run screenshots && bun run video:features && bun run video:themes"
```

Note: `bun run screenshots` auto-starts the dev server via Playwright's `webServer` config. The video scripts (`video:features`, `video:themes`) require the dev server to already be running at `http://localhost:5173`. Run `bun run dev` in a separate terminal before calling `bun run assets`, or call each script individually.

- [ ] **Step 2: Ignore tmp dirs in `.gitignore`**

Append to `.gitignore`:

```
# Screenshot automation tmp dirs
docs/screenshots/tmp-video/
docs/screenshots/tmp-themes/
```

- [ ] **Step 3: Verify the full pipeline**

With `bun run dev` running in one terminal:

```bash
bun run assets
```

Expected: all 7 PNGs, 2 MP4s, 2 GIFs present in `docs/screenshots/`. No errors.

- [ ] **Step 4: Final commit**

```bash
git add package.json .gitignore
git commit -m "feat: add master assets script and gitignore tmp dirs"
```
