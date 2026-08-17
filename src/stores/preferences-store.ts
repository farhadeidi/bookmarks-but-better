import { create } from "zustand"
import type { BrowserAdapter } from "@/browser"
import {
  ProfileStorageAdapter,
  readProfilePreference,
} from "@/stores/profile-storage"

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
  // Source-scoped: keyed to one source's folder ids, read and written
  // through the active source's storage adapter.
  cardLayouts: Record<string, CardLayout>
  folderOrder: string[]
  // Profile-wide: this browser profile's look and feel, independent of the
  // active source. Stored in the fixed profile namespace.
  nestedFolders: boolean
  colorTheme: ColorTheme
  maxColumns: number
  containerMode: "fluid" | "contained"
  experimentalCardDrag: boolean
  isFoldersOnlyEnabledInTreeEditor: boolean
  adapter: BrowserAdapter | null

  // Actions
  init(
    adapter: BrowserAdapter,
    options?: { isCurrent?: () => boolean }
  ): Promise<void>
  setCardLayout(folderId: string, layout: CardLayout): void
  setNestedFolders(value: boolean): void
  setColorTheme(theme: ColorTheme): void
  setMaxColumns(value: number): void
  setContainerMode(mode: "fluid" | "contained"): void
  setFolderOrder(order: string[]): void
  setExperimentalCardDrag(value: boolean): void
  setIsFoldersOnlyEnabledInTreeEditor(value: boolean): void
}

/** One profile-wide store for the whole session; never re-created per source. */
const profileStorage = new ProfileStorageAdapter()

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  cardLayouts: {},
  nestedFolders: false,
  colorTheme: "default",
  maxColumns: 4,
  containerMode: "contained",
  folderOrder: [],
  experimentalCardDrag: false,
  isFoldersOnlyEnabledInTreeEditor: true,
  adapter: null,

  async init(adapter: BrowserAdapter, options = {}) {
    // See bookmark-store.init: a superseded Source Session transition must
    // not apply its (source-scoped) preferences over the newer session's.
    const isCurrent = options.isCurrent ?? (() => true)
    if (!isCurrent()) return
    set({ adapter })

    const [
      cardLayouts,
      nestedFolders,
      colorTheme,
      maxColumns,
      containerMode,
      folderOrder,
      experimentalCardDrag,
      isFoldersOnlyEnabledInTreeEditor,
    ] = await Promise.all([
      adapter.storage.get<Record<string, CardLayout>>("cardLayouts"),
      readProfilePreference<boolean>("nestedFolders", adapter.storage),
      readProfilePreference<ColorTheme>("colorTheme", adapter.storage),
      readProfilePreference<number>("maxColumns", adapter.storage),
      readProfilePreference<"fluid" | "contained">(
        "containerMode",
        adapter.storage
      ),
      adapter.storage.get<string[]>("folderOrder"),
      readProfilePreference<boolean>("experimentalCardDrag", adapter.storage),
      readProfilePreference<boolean>(
        "isFoldersOnlyEnabledInTreeEditor",
        adapter.storage
      ),
    ])

    // A second transition may have started (and finished) during those
    // reads; its values are the live ones, and a superseded session must
    // not apply over them. Mirrors bookmark-store.init's re-checks.
    if (!isCurrent()) return

    const isFreshState =
      cardLayouts === null &&
      nestedFolders === null &&
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

    if (!isCurrent()) return

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
      isFoldersOnlyEnabledInTreeEditor:
        isFoldersOnlyEnabledInTreeEditor ??
        (seedPrefDefaults?.isFoldersOnlyEnabledInTreeEditor as
          | boolean
          | undefined) ??
        true,
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
    void profileStorage.set("nestedFolders", value)
  },

  setColorTheme(theme: ColorTheme) {
    set({ colorTheme: theme })
    void profileStorage.set("colorTheme", theme)
    applyColorTheme(theme)
  },

  setMaxColumns(value: number) {
    const clamped = Math.max(2, Math.min(6, value))
    set({ maxColumns: clamped })
    void profileStorage.set("maxColumns", clamped)
  },

  setContainerMode(mode: "fluid" | "contained") {
    set({ containerMode: mode })
    void profileStorage.set("containerMode", mode)
  },

  setFolderOrder(order: string[]) {
    set({ folderOrder: order })
    get().adapter?.storage.set("folderOrder", order)
  },

  setExperimentalCardDrag(value: boolean) {
    set({ experimentalCardDrag: value })
    void profileStorage.set("experimentalCardDrag", value)
  },

  setIsFoldersOnlyEnabledInTreeEditor(value: boolean) {
    set({ isFoldersOnlyEnabledInTreeEditor: value })
    void profileStorage.set("isFoldersOnlyEnabledInTreeEditor", value)
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
