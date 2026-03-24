# Public Release & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the extension for public GitHub release and Chrome Web Store submission — codebase cleanup, first-run onboarding wizard, seed data, screenshots, README, and store listing.

**Architecture:** Two workstreams in sequence. First, codebase cleanup and the onboarding wizard feature (new `src/features/onboarding/` module with step-based modal, wired into `App.tsx` via storage flag check). Then release assets: curated seed data, automated screenshots via agent-browser, README update, and store listing copy.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Zustand, shadcn Dialog, CSS transforms for animations, agent-browser for screenshots.

**Spec:** `docs/superpowers/specs/2026-03-25-public-release-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/features/onboarding/onboarding-wizard.tsx` | Main wizard component — modal overlay, step management, slide animations |
| `src/features/onboarding/steps/welcome-step.tsx` | Step 0: logo, title, tagline |
| `src/features/onboarding/steps/root-folder-step.tsx` | Step 1: root folder picker |
| `src/features/onboarding/steps/appearance-step.tsx` | Step 2: theme grid + light/dark/system toggle |
| `src/features/onboarding/steps/done-step.tsx` | Step 3: completion screen |
| `src/features/onboarding/index.ts` | Barrel export |
| `LICENSE` | MIT license text |
| `docs/store-listing.md` | Chrome Web Store description and metadata |
| `docs/screenshots/` | Directory for automated screenshots |

### Modified Files
| File | Changes |
|------|---------|
| `src/App.tsx` | Add onboarding state check, render `OnboardingWizard` conditionally |
| `src/browser/standalone/bookmarks.ts:161` | Update seed data import path from `../../../dev/` to `@/dev/` |
| `src/dev/seed-bookmarks.json` | Moved from `dev/`, updated with curated "best of the internet" bookmarks |
| `.gitignore` | Add `.superpowers/` |
| `README.md` | Add screenshots, license badge, dev section |

---

## Task 1: Codebase Cleanup

**Files:**
- Move: `dev/seed-bookmarks.json` → `src/dev/seed-bookmarks.json`
- Modify: `src/browser/standalone/bookmarks.ts:161`
- Create: `LICENSE`
- Modify: `.gitignore`

- [ ] **Step 1: Move `dev/` directory into `src/`**

```bash
mv dev src/dev
```

- [ ] **Step 2: Update the seed data import path**

In `src/browser/standalone/bookmarks.ts`, change line 161:

```typescript
// Before:
const { default: seedData } = await import("../../../dev/seed-bookmarks.json")

// After:
const { default: seedData } = await import("@/dev/seed-bookmarks.json")
```

Note: The `@` alias resolves to `./src` via `vite.config.ts`, so `@/dev/seed-bookmarks.json` → `src/dev/seed-bookmarks.json`.

- [ ] **Step 3: Add MIT LICENSE file**

Create `LICENSE` at repo root with the standard MIT license text. Use the current year (2026) and author "Farhad" (from git history).

- [ ] **Step 4: Add `.superpowers/` to `.gitignore`**

Append to `.gitignore`:

```
# Superpowers brainstorm artifacts
.superpowers/
```

- [ ] **Step 5: Run codebase sweep**

Scan the codebase for:
- Hardcoded secrets, API keys, personal file paths
- Debug `console.log` statements
- `TODO`/`FIXME` comments referencing internal context

Remove or clean up anything found. If the codebase is clean, note it and move on.

- [ ] **Step 6: Verify the build still works**

```bash
bun run typecheck && bun run build
```

Expected: Both pass with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/dev/ LICENSE .gitignore src/browser/standalone/bookmarks.ts
git commit -m "chore: move dev/ into src/, add MIT license, update gitignore"
```

Also `git rm` the old `dev/` location if git doesn't auto-detect the move.

---

## Task 2: Update Seed Data

**Files:**
- Modify: `src/dev/seed-bookmarks.json`

- [ ] **Step 1: Replace seed data with curated bookmarks**

Replace the contents of `src/dev/seed-bookmarks.json` with a curated "best of the internet" collection. Follow the same JSON structure (nested `BookmarkNode[]`).

**Folder structure:**

| Folder | Bookmarks (title → url) |
|--------|------------------------|
| Social | YouTube → youtube.com, X → x.com, Reddit → reddit.com, Instagram → instagram.com, TikTok → tiktok.com, Discord → discord.com, Twitch → twitch.tv |
| Productivity | Gmail → mail.google.com, Google Calendar → calendar.google.com, Google Drive → drive.google.com, Notion → notion.so, Slack → slack.com, Todoist → todoist.com |
| Entertainment | Netflix → netflix.com, Spotify → spotify.com, Steam → store.steampowered.com, Crunchyroll → crunchyroll.com, IMDb → imdb.com |
| News & Reading | Hacker News → news.ycombinator.com, The Verge → theverge.com, Medium → medium.com, Substack → substack.com, Wikipedia → wikipedia.org |
| Dev Tools | GitHub → github.com, Stack Overflow → stackoverflow.com, MDN → developer.mozilla.org, VS Code → code.visualstudio.com, CodePen → codepen.io, npm → npmjs.com |
| Design | Figma → figma.com, Dribbble → dribbble.com, Behance → behance.net, Unsplash → unsplash.com, Coolors → coolors.co |
| AI | Claude → claude.ai, ChatGPT → chat.openai.com, Perplexity → perplexity.ai, Midjourney → midjourney.com, Hugging Face → huggingface.co |

All URLs should use `https://` prefix. Keep the same root structure: root node `id: "0"` with children `id: "1"` (Bookmarks Bar) containing the folders above, and `id: "2"` (Other Bookmarks) kept minimal.

- [ ] **Step 2: Verify dev server loads with new seed data**

Clear IndexedDB data first (the standalone adapter seeds from JSON only when DB is empty), then run:

```bash
bun dev
```

Open in browser, verify all folders and bookmarks appear with recognizable favicons.

- [ ] **Step 3: Commit**

```bash
git add src/dev/seed-bookmarks.json
git commit -m "feat: update seed bookmarks with curated popular sites"
```

---

## Task 3: Build Onboarding Wizard — Welcome & Done Steps

**Files:**
- Create: `src/features/onboarding/steps/welcome-step.tsx`
- Create: `src/features/onboarding/steps/done-step.tsx`

- [ ] **Step 1: Create the welcome step component**

`src/features/onboarding/steps/welcome-step.tsx`:

```tsx
export function WelcomeStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8 text-center">
      <img src="/logo.svg" alt="Bookmarks But Better" className="h-20 w-20 dark:hidden" />
      <img src="/logo-dark.svg" alt="Bookmarks But Better" className="hidden h-20 w-20 dark:block" />
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Bookmarks — But Better</h2>
        <p className="text-muted-foreground">Your bookmarks, beautifully organized.</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the done step component**

`src/features/onboarding/steps/done-step.tsx`:

```tsx
export function DoneStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">You're all set!</h2>
        <p className="text-muted-foreground">
          Your new tab is ready. You can always change these in settings.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/onboarding/steps/
git commit -m "feat: add welcome and done step components for onboarding wizard"
```

---

## Task 4: Build Onboarding Wizard — Root Folder Step

**Files:**
- Create: `src/features/onboarding/steps/root-folder-step.tsx`

- [ ] **Step 1: Create the root folder step**

This step reuses the existing `RootFolderPicker` from settings. It manages local state for the selected folder ID, which the parent wizard reads on completion.

`src/features/onboarding/steps/root-folder-step.tsx`:

```tsx
import { RootFolderPicker } from "@/features/settings/root-folder-picker"

interface RootFolderStepProps {
  value: string | null
  onChange: (id: string | null) => void
}

export function RootFolderStep({ value, onChange }: RootFolderStepProps) {
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Choose your bookmark folder</h2>
        <p className="text-muted-foreground">
          Pick a folder to display on your new tab page. You can change this later in settings.
        </p>
      </div>
      <RootFolderPicker value={value} onChange={onChange} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/onboarding/steps/root-folder-step.tsx
git commit -m "feat: add root folder step for onboarding wizard"
```

---

## Task 5: Build Onboarding Wizard — Appearance Step

**Files:**
- Create: `src/features/onboarding/steps/appearance-step.tsx`

- [ ] **Step 1: Create the appearance step**

This step has a theme grid and a light/dark/system segmented control. Selections are applied live and managed via props from the parent wizard.

`src/features/onboarding/steps/appearance-step.tsx`:

```tsx
import { COLOR_THEMES, type ColorTheme } from "@/stores/preferences-store"
import { cn } from "@/lib/utils"

type ThemeMode = "light" | "dark" | "system"

interface AppearanceStepProps {
  colorTheme: ColorTheme
  onColorThemeChange: (theme: ColorTheme) => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}

const THEME_COLORS: Record<ColorTheme, string> = {
  default: "bg-zinc-700",
  "amber-minimal": "bg-amber-600",
  bubblegum: "bg-pink-500",
  caffeine: "bg-amber-900",
  claude: "bg-orange-500",
  claymorphism: "bg-stone-400",
  cyberpunk: "bg-fuchsia-500",
  "solar-dusk": "bg-orange-700",
  "t3-chat": "bg-violet-600",
  "vintage-paper": "bg-yellow-800",
}

const THEME_LABELS: Record<ColorTheme, string> = {
  default: "Default",
  "amber-minimal": "Amber",
  bubblegum: "Bubblegum",
  caffeine: "Caffeine",
  claude: "Claude",
  claymorphism: "Clay",
  cyberpunk: "Cyberpunk",
  "solar-dusk": "Solar Dusk",
  "t3-chat": "T3 Chat",
  "vintage-paper": "Vintage",
}

const MODES: ThemeMode[] = ["light", "dark", "system"]

export function AppearanceStep({
  colorTheme,
  onColorThemeChange,
  themeMode,
  onThemeModeChange,
}: AppearanceStepProps) {
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Make it yours</h2>
        <p className="text-muted-foreground">
          Choose a theme and color mode. We recommend Default theme with Dark mode.
        </p>
      </div>

      {/* Theme grid */}
      <div className="grid grid-cols-5 gap-3">
        {COLOR_THEMES.map((t) => (
          <button
            key={t}
            onClick={() => onColorThemeChange(t)}
            className={cn(
              "group relative flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors",
              colorTheme === t
                ? "bg-accent ring-2 ring-primary"
                : "hover:bg-accent/50"
            )}
          >
            <div className={cn("h-8 w-8 rounded-full", THEME_COLORS[t])} />
            <span className="text-xs">{THEME_LABELS[t]}</span>
            {t === "default" && (
              <span className="absolute -top-1 -right-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                Rec
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Mode toggle */}
      <div className="flex flex-col gap-2">
        <div className="flex rounded-lg border border-border p-1">
          {MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => onThemeModeChange(mode)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                themeMode === mode
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/onboarding/steps/appearance-step.tsx
git commit -m "feat: add appearance step with theme grid and mode toggle"
```

---

## Task 6: Build Onboarding Wizard — Main Component

**Files:**
- Create: `src/features/onboarding/onboarding-wizard.tsx`
- Create: `src/features/onboarding/index.ts`

- [ ] **Step 1: Create the wizard component**

`src/features/onboarding/onboarding-wizard.tsx`:

The wizard manages:
- `currentStep` (0–3)
- Local state for root folder ID, color theme, theme mode
- Slide animation via CSS transforms
- On completion: persists to the correct stores

```tsx
import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore, type ColorTheme } from "@/stores/preferences-store"
import { useTheme } from "@/components/theme-provider"
import { WelcomeStep } from "./steps/welcome-step"
import { RootFolderStep } from "./steps/root-folder-step"
import { AppearanceStep } from "./steps/appearance-step"
import { DoneStep } from "./steps/done-step"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ThemeMode = "light" | "dark" | "system"

const TOTAL_STEPS = 4

interface OnboardingWizardProps {
  onComplete: () => void
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = React.useState(0)
  const [direction, setDirection] = React.useState<"forward" | "backward">("forward")

  // Local wizard state
  const [rootFolderId, setRootFolderId] = React.useState<string | null>(null)
  const [colorTheme, setColorTheme] = React.useState<ColorTheme>("default")
  const [themeMode, setThemeMode] = React.useState<ThemeMode>("dark")

  // Store actions for persisting on completion
  const setStoreRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const setStoreColorTheme = usePreferencesStore((s) => s.setColorTheme)
  const adapter = usePreferencesStore((s) => s.adapter)
  const { setTheme } = useTheme()

  // Apply theme changes live as the user selects them
  const handleColorThemeChange = React.useCallback(
    (theme: ColorTheme) => {
      setColorTheme(theme)
      // Apply live so the user sees the change behind the blur
      usePreferencesStore.getState().setColorTheme(theme)
    },
    []
  )

  const handleThemeModeChange = React.useCallback(
    (mode: ThemeMode) => {
      setThemeMode(mode)
      setTheme(mode)
    },
    [setTheme]
  )

  // Apply dark mode on mount (wizard defaults to dark)
  React.useEffect(() => {
    setTheme("dark")
  }, [setTheme])

  const goNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setDirection("forward")
      setCurrentStep((s) => s + 1)
    }
  }

  const goBack = () => {
    if (currentStep > 0) {
      setDirection("backward")
      setCurrentStep((s) => s - 1)
    }
  }

  const handleComplete = async () => {
    // Persist all selections
    setStoreRootFolderId(rootFolderId)
    setStoreColorTheme(colorTheme)
    setTheme(themeMode)

    // Set onboarding completed flag
    await adapter?.storage.set("onboardingCompleted", true)

    onComplete()
  }

  const handleSkip = async () => {
    // Preserve any root folder selection already made, use defaults for the rest
    setStoreRootFolderId(rootFolderId)
    setStoreColorTheme("default")
    setTheme("dark")

    await adapter?.storage.set("onboardingCompleted", true)

    onComplete()
  }

  const nextButtonText = (() => {
    switch (currentStep) {
      case 0: return "Get Started"
      case TOTAL_STEPS - 1: return "Start Browsing"
      default: return "Next"
    }
  })()

  const handleNextClick = () => {
    if (currentStep === TOTAL_STEPS - 1) {
      handleComplete()
    } else {
      goNext()
    }
  }

  return (
    // Overlay with blur
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xl animate-in fade-in duration-200">
      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Skip link */}
        {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
          <button
            onClick={handleSkip}
            className="absolute top-4 right-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip, use defaults
          </button>
        )}

        {/* Step content with slide animation */}
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-300 ease-in-out"
            style={{ transform: `translateX(-${currentStep * 100}%)` }}
          >
            {[
              <WelcomeStep key="welcome" />,
              <RootFolderStep key="root-folder" value={rootFolderId} onChange={setRootFolderId} />,
              <AppearanceStep
                key="appearance"
                colorTheme={colorTheme}
                onColorThemeChange={handleColorThemeChange}
                themeMode={themeMode}
                onThemeModeChange={handleThemeModeChange}
              />,
              <DoneStep key="done" />,
            ].map((step, i) => (
              <div key={i} className="w-full flex-shrink-0">
                {step}
              </div>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
              <Button variant="ghost" onClick={goBack}>
                Back
              </Button>
            )}
          </div>

          <Button onClick={handleNextClick}>
            {nextButtonText}
          </Button>
        </div>

        {/* Step dots */}
        <div className="mt-4 flex justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                i === currentStep ? "bg-primary" : "bg-muted-foreground/30"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the barrel export**

`src/features/onboarding/index.ts`:

```typescript
export { OnboardingWizard } from "./onboarding-wizard"
```

- [ ] **Step 3: Commit**

```bash
git add src/features/onboarding/
git commit -m "feat: add onboarding wizard with step navigation and slide animations"
```

---

## Task 7: Wire Up First-Run Detection in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add onboarding state and conditional rendering**

In `src/App.tsx`, add state for tracking onboarding completion. Check the flag after adapter initialization. Render `OnboardingWizard` when onboarding hasn't been completed.

Changes to `App.tsx`:

1. Import the wizard:
```tsx
import { OnboardingWizard } from "@/features/onboarding"
```

2. Add state:
```tsx
const [showOnboarding, setShowOnboarding] = React.useState(false)
const [onboardingChecked, setOnboardingChecked] = React.useState(false)
```

3. In the bootstrap function, after `Promise.all([initBookmarks, initPreferences])`, check the onboarding flag:
```tsx
async function bootstrap() {
  const adapter = await detectAdapter()
  await Promise.all([initBookmarks(adapter), initPreferences(adapter)])

  const onboardingCompleted = await adapter.storage.get<boolean>("onboardingCompleted")
  if (!onboardingCompleted) {
    setShowOnboarding(true)
  }
  setOnboardingChecked(true)
}
```

4. In the JSX, render the wizard conditionally after the main content (and after dialogs):
```tsx
{showOnboarding && onboardingChecked && (
  <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
)}
```

Wait for `onboardingChecked` to avoid flash — don't render the wizard until we know whether to show it.

- [ ] **Step 2: Verify the wizard appears on first run**

```bash
bun dev
```

Open in browser. Clear IndexedDB (Application → Storage → Clear site data) and reload. The wizard should appear over the blurred dashboard. Complete it. Reload — wizard should not appear again.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up first-run onboarding detection in App"
```

---

## Task 8: Automated Screenshots via agent-browser

**Files:**
- Create: `docs/screenshots/` (directory for output)

- [ ] **Step 1: Start the dev server**

```bash
bun dev
```

Keep it running in the background.

- [ ] **Step 2: Use agent-browser to capture screenshots**

Use the `agent-browser` skill to automate the following captures at 1280x800 viewport:

1. **Dashboard dark mode** — Navigate to the dev server URL. Ensure dark mode is active and default theme is applied. Take a full-page screenshot. Save as `docs/screenshots/dashboard-dark.png`.

2. **Dashboard alternate theme** — Switch to the "claude" or "cyberpunk" theme via the FAB dropdown. Take screenshot. Save as `docs/screenshots/dashboard-theme.png`.

3. **Hover card** — Hover over a bookmark item (e.g., YouTube) to trigger the hover card. Take screenshot. Save as `docs/screenshots/hover-card.png`.

4. **Settings dialog** — Click the settings FAB button to open the settings dialog. Take screenshot. Save as `docs/screenshots/settings.png`.

5. **Onboarding wizard** — Clear the `onboardingCompleted` flag from storage, reload the page so the wizard appears. Take screenshot. Save as `docs/screenshots/onboarding.png`.

- [ ] **Step 3: Commit**

```bash
git add docs/screenshots/
git commit -m "docs: add screenshots for README and Chrome Web Store"
```

---

## Task 9: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

Changes:

1. Add MIT license badge after the header:
```markdown
<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
</p>
```

2. Replace the Screenshots section:
```markdown
## Screenshots

<p align="center">
  <img src="docs/screenshots/dashboard-dark.png" width="700" alt="Dashboard in dark mode" />
</p>

<p align="center">
  <img src="docs/screenshots/dashboard-theme.png" width="700" alt="Dashboard with alternate theme" />
</p>

<p align="center">
  <img src="docs/screenshots/hover-card.png" width="700" alt="Bookmark hover card" />
</p>

<p align="center">
  <img src="docs/screenshots/onboarding.png" width="700" alt="First-run onboarding wizard" />
</p>
```

3. Update the Chrome Web Store note — replace the placeholder with:
```markdown
> **Chrome Web Store:** [Install from the Chrome Web Store](link-pending)
```

4. Add a Development section before the License section:
```markdown
## Development

```bash
bun install        # Install dependencies
bun dev            # Start dev server (standalone mode)
bun run build      # Build for production → dist/
bun run typecheck  # Type check
bun lint           # Lint
bun run format     # Format code
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with screenshots, license badge, and dev instructions"
```

---

## Task 10: Chrome Web Store Listing Copy

**Files:**
- Create: `docs/store-listing.md`

- [ ] **Step 1: Write the store listing document**

`docs/store-listing.md`:

```markdown
# Chrome Web Store Listing

## Short Description (132 chars max)

A clean, beautiful bookmarks dashboard for your new tab. Masonry layout, 10 themes, dark mode, and full bookmark management.

## Detailed Description

Bookmarks - But Better replaces your new tab page with a clean, organized bookmarks dashboard.

**Features:**
• Masonry layout — your bookmark folders displayed as cards in a responsive grid
• Two view modes — switch between list and icon grid on each folder
• 10 color themes — Default, Amber, Bubblegum, Caffeine, Claude, Claymorphism, Cyberpunk, Solar Dusk, T3 Chat, Vintage Paper
• Light & dark mode — follows your system preference, or toggle manually
• Edit inline — rename bookmarks, change URLs, manage folders
• Choose your root folder — display bookmarks from any folder as your starting point
• Import & export — standard HTML bookmark format
• High-quality favicons — sharp icons on all displays
• Always in sync — changes save directly to Chrome bookmarks

**Privacy:**
No data collection. No analytics. No tracking. All your data stays in your browser using Chrome's built-in bookmarks and storage APIs. The only external request is fetching favicons from Google's public favicon service.

## Category

Productivity

## Tags

bookmarks, new tab, dashboard, productivity, themes

## Promotional Images

- Small tile: 440×280 (required for featuring)
- Large tile: 1400×560 (optional marquee)

These need to be created manually with a design tool. Suggested content:
- Extension logo centered
- Tagline: "Your bookmarks, beautifully organized."
- Dark background with a subtle screenshot preview
```

- [ ] **Step 2: Commit**

```bash
git add docs/store-listing.md
git commit -m "docs: add Chrome Web Store listing copy"
```
