import { create } from "zustand"
import type { BrowserAdapter } from "@/browser"

type CardLayout = "list" | "grid"
export type ColorTheme = "default" | "amber-minimal" | "bubblegum" | "caffeine" | "claude" | "claymorphism" | "cyberpunk" | "solar-dusk" | "t3-chat" | "vintage-paper"

export const COLOR_THEMES: ColorTheme[] = ["default", "amber-minimal", "bubblegum", "caffeine", "claude", "claymorphism", "cyberpunk", "solar-dusk", "t3-chat", "vintage-paper"]

interface PreferencesState {
  cardLayouts: Record<string, CardLayout>
  nestedFolders: boolean
  adapterMode: "browser" | "standalone"
  colorTheme: ColorTheme
  adapter: BrowserAdapter | null

  // Actions
  init(adapter: BrowserAdapter): Promise<void>
  setCardLayout(folderId: string, layout: CardLayout): void
  setNestedFolders(value: boolean): void
  setAdapterMode(mode: "browser" | "standalone"): void
  setColorTheme(theme: ColorTheme): void
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  cardLayouts: {},
  nestedFolders: false,
  adapterMode: "browser",
  colorTheme: "default",
  adapter: null,

  async init(adapter: BrowserAdapter) {
    set({ adapter })

    const [cardLayouts, nestedFolders, adapterMode, colorTheme] =
      await Promise.all([
        adapter.storage.get<Record<string, CardLayout>>("cardLayouts"),
        adapter.storage.get<boolean>("nestedFolders"),
        adapter.storage.get<"browser" | "standalone">("adapterMode"),
        adapter.storage.get<ColorTheme>("colorTheme"),
      ])

    const resolvedColorTheme = colorTheme ?? "default"

    set({
      cardLayouts: cardLayouts ?? {},
      nestedFolders: nestedFolders ?? false,
      adapterMode: adapterMode ?? "browser",
      colorTheme: resolvedColorTheme,
    })

    // Apply color theme to root element
    applyColorTheme(resolvedColorTheme)
  },

  setCardLayout(folderId: string, layout: CardLayout) {
    const { cardLayouts, adapter } = get()
    const updated = { ...cardLayouts, [folderId]: layout }
    set({ cardLayouts: updated })
    adapter?.storage.set("cardLayouts", updated)
  },

  setNestedFolders(value: boolean) {
    set({ nestedFolders: value })
    get().adapter?.storage.set("nestedFolders", value)
  },

  setAdapterMode(mode: "browser" | "standalone") {
    set({ adapterMode: mode })
    get().adapter?.storage.set("adapterMode", mode)
  },

  setColorTheme(theme: ColorTheme) {
    set({ colorTheme: theme })
    get().adapter?.storage.set("colorTheme", theme)
    applyColorTheme(theme)
  },
}))

function applyColorTheme(theme: ColorTheme) {
  const root = document.documentElement
  if (theme === "default") {
    root.removeAttribute("data-color-theme")
  } else {
    root.setAttribute("data-color-theme", theme)
  }
}
