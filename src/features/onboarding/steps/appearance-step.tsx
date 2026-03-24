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
