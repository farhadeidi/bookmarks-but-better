import { create } from "zustand"
import type { BrowserAdapter } from "@/browser"

type CardLayout = "list" | "grid"

interface PreferencesState {
  cardLayouts: Record<string, CardLayout>
  nestedFolders: boolean
  adapterMode: "browser" | "standalone"
  adapter: BrowserAdapter | null

  // Actions
  init(adapter: BrowserAdapter): Promise<void>
  setCardLayout(folderId: string, layout: CardLayout): void
  setNestedFolders(value: boolean): void
  setAdapterMode(mode: "browser" | "standalone"): void
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  cardLayouts: {},
  nestedFolders: false,
  adapterMode: "browser",
  adapter: null,

  async init(adapter: BrowserAdapter) {
    set({ adapter })

    const [cardLayouts, nestedFolders, adapterMode] = await Promise.all([
      adapter.storage.get<Record<string, CardLayout>>("cardLayouts"),
      adapter.storage.get<boolean>("nestedFolders"),
      adapter.storage.get<"browser" | "standalone">("adapterMode"),
    ])

    set({
      cardLayouts: cardLayouts ?? {},
      nestedFolders: nestedFolders ?? false,
      adapterMode: adapterMode ?? "browser",
    })
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
}))
