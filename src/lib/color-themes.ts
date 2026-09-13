export const COLOR_THEME_IDS = [
  "default",
  "amber-minimal",
  "bubblegum",
  "caffeine",
  "claude",
  "claymorphism",
  "cyberpunk",
  "solar-dusk",
  "t3-chat",
  "vintage-paper",
] as const

export type ColorThemeId = (typeof COLOR_THEME_IDS)[number]

export const COLOR_THEME_LABELS: Record<ColorThemeId, string> = {
  default: "Default",
  "amber-minimal": "Amber Minimal",
  bubblegum: "Bubblegum",
  caffeine: "Caffeine",
  claude: "Claude",
  claymorphism: "Claymorphism",
  cyberpunk: "Cyberpunk",
  "solar-dusk": "Solar Dusk",
  "t3-chat": "T3 Chat",
  "vintage-paper": "Vintage Paper",
}
