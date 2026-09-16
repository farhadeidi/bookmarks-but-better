import { COLOR_THEME_IDS } from "../../../src/lib/color-themes"

type ColorTheme = (typeof COLOR_THEME_IDS)[number]

export interface DemoTheme {
  id: ColorTheme
  name: string
  accent: string
}

const THEME_DETAILS: Record<ColorTheme, Omit<DemoTheme, "id">> = {
  default: { name: "Default", accent: "#6b7280" },
  "amber-minimal": { name: "Amber Minimal", accent: "#f59e0b" },
  bubblegum: { name: "Bubblegum", accent: "#ec4899" },
  caffeine: { name: "Caffeine", accent: "#92400e" },
  claude: { name: "Claude", accent: "#f97316" },
  claymorphism: { name: "Claymorphism", accent: "#8b5cf6" },
  cyberpunk: { name: "Cyberpunk", accent: "#e879f9" },
  "solar-dusk": { name: "Solar Dusk", accent: "#fb923c" },
  "t3-chat": { name: "T3 Chat", accent: "#f43f5e" },
  "vintage-paper": { name: "Vintage Paper", accent: "#d97706" },
}

/**
 * The ten themes, as the live preview's strip of dots shows them. The app
 * itself owns which one is active: a dot asks it to switch and the app reports
 * back, so nothing here is a default. (The hero screenshot is Amber Minimal.)
 */
export const DEMO_THEMES: DemoTheme[] = COLOR_THEME_IDS.map((id) => ({
  id,
  ...THEME_DETAILS[id],
}))
