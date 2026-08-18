export interface DemoTheme {
  id: string
  name: string
  accent: string
}

export const DEMO_THEMES: DemoTheme[] = [
  { id: "default", name: "Default", accent: "#6b7280" },
  { id: "amber-minimal", name: "Amber Minimal", accent: "#f59e0b" },
  { id: "bubblegum", name: "Bubblegum", accent: "#ec4899" },
  { id: "caffeine", name: "Caffeine", accent: "#92400e" },
  { id: "claude", name: "Claude", accent: "#f97316" },
  { id: "claymorphism", name: "Claymorphism", accent: "#8b5cf6" },
  { id: "cyberpunk", name: "Cyberpunk", accent: "#e879f9" },
  { id: "solar-dusk", name: "Solar Dusk", accent: "#fb923c" },
  { id: "t3-chat", name: "T3 Chat", accent: "#f43f5e" },
  { id: "vintage-paper", name: "Vintage Paper", accent: "#d97706" },
]

export const PICK_THEME_EVENT = "bbb:pick-theme"
