import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { COLOR_THEME_LABELS } from "@/lib/color-themes"
import {
  usePreferencesStore,
  COLOR_THEMES,
  type ColorTheme,
} from "@/stores/preferences-store"
import { SettingGroup, SettingRow, SettingSection } from "./setting-row"

type Scheme = "system" | "light" | "dark"

const SCHEMES: { id: Scheme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
]

/**
 * The dashboard in miniature: the Source Switcher pill up top, folder cards
 * with their bookmark rows below, and the floating action pill in the corner.
 * It is drawn entirely from theme tokens, so wrapping it in `.light` /
 * `.dark` and a `data-color-theme` shows exactly what that combination
 * looks like.
 */
function MiniFolderCard({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-card p-1.5 ring-1 ring-border">
      <div className="h-1 w-2/3 rounded-full bg-foreground/70" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-1">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-[2px]",
              i === 0 ? "bg-primary" : "bg-muted-foreground/50"
            )}
          />
          <span className="h-1 flex-1 rounded-full bg-muted-foreground/30" />
        </div>
      ))}
    </div>
  )
}

function MiniDashboard() {
  return (
    <div className="relative flex h-full w-full flex-col gap-1.5 bg-background p-2 text-foreground">
      <div className="mx-auto flex h-2.5 w-[55%] gap-0.5 rounded-full bg-muted/60 p-0.5 ring-1 ring-border/60">
        <span className="h-full flex-1 rounded-full bg-background" />
        <span className="h-full flex-1" />
      </div>
      <div className="grid flex-1 grid-cols-3 items-start gap-1.5">
        <MiniFolderCard rows={3} />
        <MiniFolderCard rows={2} />
        <MiniFolderCard rows={3} />
      </div>
      <span className="absolute right-1.5 bottom-1.5 flex h-2.5 w-5 items-center justify-end rounded-full bg-background/90 px-0.5 ring-1 ring-border/60">
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
    </div>
  )
}

/**
 * The attribute that scopes a color theme's tokens to one element. The
 * default theme has no attribute; the root works the same way.
 */
function colorThemeAttr(theme: ColorTheme) {
  return theme === "default" ? undefined : theme
}

const PREVIEW_FRAME =
  "aspect-[16/10] w-full overflow-hidden rounded-lg ring-1 ring-border/60"

/** The dashboard in one scheme, or split down the middle for both. */
function DashboardPreview({
  scheme,
  colorTheme,
}: {
  scheme: Scheme
  colorTheme: ColorTheme
}) {
  const themeAttr = colorThemeAttr(colorTheme)
  if (scheme === "system") {
    return (
      <div className={cn("relative", PREVIEW_FRAME)}>
        <div className="light absolute inset-0" data-color-theme={themeAttr}>
          <MiniDashboard />
        </div>
        <div
          className="dark absolute inset-0"
          data-color-theme={themeAttr}
          style={{ clipPath: "inset(0 0 0 50%)" }}
        >
          <MiniDashboard />
        </div>
      </div>
    )
  }
  return (
    <div className={cn(scheme, PREVIEW_FRAME)} data-color-theme={themeAttr}>
      <MiniDashboard />
    </div>
  )
}

export function AppearancePanel() {
  const colorTheme = usePreferencesStore((s) => s.colorTheme)
  const setColorTheme = usePreferencesStore((s) => s.setColorTheme)
  const maxColumns = usePreferencesStore((s) => s.maxColumns)
  const setMaxColumns = usePreferencesStore((s) => s.setMaxColumns)
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const setContainerMode = usePreferencesStore((s) => s.setContainerMode)
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="Color scheme">
        <div
          role="radiogroup"
          aria-label="Color scheme"
          className="grid grid-cols-3 gap-3"
        >
          {SCHEMES.map((scheme) => {
            const checked = theme === scheme.id
            return (
              <button
                key={scheme.id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setTheme(scheme.id)}
                className={cn(
                  "flex flex-col gap-2 rounded-xl p-2 text-left ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  checked
                    ? "bg-accent/40 ring-2 ring-primary"
                    : "ring-border/60 hover:bg-accent/30 hover:ring-border"
                )}
              >
                <DashboardPreview scheme={scheme.id} colorTheme={colorTheme} />
                <span className="text-center text-sm">{scheme.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Applies to this browser profile on every source. Press{" "}
          <kbd className="rounded border border-border/60 bg-muted px-1 font-mono text-[11px]">
            D
          </kbd>{" "}
          on the dashboard to flip between light and dark.
        </p>
      </SettingSection>

      <SettingSection title="Theme">
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        >
          {COLOR_THEMES.map((id) => {
            const checked = colorTheme === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setColorTheme(id)}
                className={cn(
                  "flex flex-col gap-2 rounded-xl p-2 text-left ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  checked
                    ? "bg-accent/40 ring-2 ring-primary"
                    : "ring-border/60 hover:bg-accent/30 hover:ring-border"
                )}
              >
                <DashboardPreview scheme="system" colorTheme={id} />
                <span className="flex items-center justify-between gap-2 px-1">
                  <span className="truncate text-sm">
                    {COLOR_THEME_LABELS[id]}
                  </span>
                  {checked && (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      className="size-4 shrink-0 text-primary"
                      strokeWidth={2.5}
                    />
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </SettingSection>

      <SettingSection title="Layout">
        <SettingGroup>
          <SettingRow
            title="Max columns"
            description="The most columns the dashboard grid will use. Smaller screens use fewer."
            control={
              <Select
                value={String(maxColumns)}
                onValueChange={(val) => setMaxColumns(Number(val))}
              >
                <SelectTrigger aria-label="Max columns" className="w-36">
                  <span>{maxColumns} columns</span>
                </SelectTrigger>
                <SelectContent>
                  {[2, 3, 4, 5, 6].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} columns
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingRow
            title="Width"
            description="Contained keeps the dashboard at most 1440px wide and centers it."
            control={
              <Select
                value={containerMode}
                onValueChange={(val) =>
                  setContainerMode(val as "fluid" | "contained")
                }
              >
                <SelectTrigger aria-label="Width" className="w-36">
                  <span>
                    {containerMode === "fluid" ? "Fluid" : "Contained"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contained">Contained</SelectItem>
                  <SelectItem value="fluid">Fluid</SelectItem>
                </SelectContent>
              </Select>
            }
          />
        </SettingGroup>
      </SettingSection>
    </div>
  )
}
