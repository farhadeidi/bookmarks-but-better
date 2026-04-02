import { create } from "zustand"
import type { BrowserAdapter } from "@/browser"

type CardLayout = "list" | "grid"
export type ColorTheme =
  | "default"
  | "amber-minimal"
  | "bubblegum"
  | "caffeine"
  | "claude"
  | "claymorphism"
  | "cyberpunk"
  | "solar-dusk"
  | "t3-chat"
  | "vintage-paper"

export const COLOR_THEMES: ColorTheme[] = [
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
]

interface PreferencesState {
  cardLayouts: Record<string, CardLayout>
  nestedFolders: boolean
  adapterMode: "browser" | "standalone"
  colorTheme: ColorTheme
  maxColumns: number
  containerMode: "fluid" | "contained"
  folderOrder: string[]
  experimentalCardDrag: boolean
  adapter: BrowserAdapter | null

  // Actions
  init(adapter: BrowserAdapter): Promise<void>
  setCardLayout(folderId: string, layout: CardLayout): void
  setNestedFolders(value: boolean): void
  setAdapterMode(mode: "browser" | "standalone"): void
  setColorTheme(theme: ColorTheme): void
  setMaxColumns(value: number): void
  setContainerMode(mode: "fluid" | "contained"): void
  setFolderOrder(order: string[]): void
  setExperimentalCardDrag(value: boolean): void
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  cardLayouts: {},
  nestedFolders: false,
  adapterMode: "browser",
  colorTheme: "default",
  maxColumns: 4,
  containerMode: "contained",
  folderOrder: [],
  experimentalCardDrag: false,
  adapter: null,

  async init(adapter: BrowserAdapter) {
    set({ adapter })

    const [
      cardLayouts,
      nestedFolders,
      adapterMode,
      colorTheme,
      maxColumns,
      containerMode,
      folderOrder,
      experimentalCardDrag,
    ] = await Promise.all([
      adapter.storage.get<Record<string, CardLayout>>("cardLayouts"),
      adapter.storage.get<boolean>("nestedFolders"),
      adapter.storage.get<"browser" | "standalone">("adapterMode"),
      adapter.storage.get<ColorTheme>("colorTheme"),
      adapter.storage.get<number>("maxColumns"),
      adapter.storage.get<"fluid" | "contained">("containerMode"),
      adapter.storage.get<string[]>("folderOrder"),
      adapter.storage.get<boolean>("experimentalCardDrag"),
    ])

    const isFreshState =
      cardLayouts === null &&
      nestedFolders === null &&
      adapterMode === null &&
      colorTheme === null &&
      maxColumns === null &&
      containerMode === null &&
      folderOrder === null &&
      experimentalCardDrag === null

    let seedPrefDefaults: Record<string, unknown> | null = null
    if (import.meta.env.DEV && isFreshState) {
      const { default: seed } = await import("@/dev/seed-preferences.json")
      seedPrefDefaults = seed as Record<string, unknown>
    }

    const resolvedColorTheme =
      colorTheme ??
      (seedPrefDefaults?.colorTheme as ColorTheme | undefined) ??
      "default"

    set({
      cardLayouts:
        cardLayouts ??
        (seedPrefDefaults?.cardLayouts as
          | Record<string, CardLayout>
          | undefined) ??
        {},
      nestedFolders:
        nestedFolders ??
        (seedPrefDefaults?.nestedFolders as boolean | undefined) ??
        false,
      adapterMode:
        adapterMode ??
        (seedPrefDefaults?.adapterMode as
          | "browser"
          | "standalone"
          | undefined) ??
        "browser",
      colorTheme: resolvedColorTheme,
      maxColumns: Math.max(
        2,
        Math.min(
          6,
          maxColumns ??
            (seedPrefDefaults?.maxColumns as number | undefined) ??
            4
        )
      ),
      containerMode:
        containerMode ??
        (seedPrefDefaults?.containerMode as
          | "fluid"
          | "contained"
          | undefined) ??
        "contained",
      folderOrder:
        folderOrder ??
        (seedPrefDefaults?.folderOrder as string[] | undefined) ??
        [],
      experimentalCardDrag:
        experimentalCardDrag ??
        (seedPrefDefaults?.experimentalCardDrag as boolean | undefined) ??
        false,
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

  setMaxColumns(value: number) {
    const clamped = Math.max(2, Math.min(6, value))
    set({ maxColumns: clamped })
    get().adapter?.storage.set("maxColumns", clamped)
  },

  setContainerMode(mode: "fluid" | "contained") {
    set({ containerMode: mode })
    get().adapter?.storage.set("containerMode", mode)
  },

  setFolderOrder(order: string[]) {
    set({ folderOrder: order })
    get().adapter?.storage.set("folderOrder", order)
  },

  setExperimentalCardDrag(value: boolean) {
    set({ experimentalCardDrag: value })
    get().adapter?.storage.set("experimentalCardDrag", value)
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
