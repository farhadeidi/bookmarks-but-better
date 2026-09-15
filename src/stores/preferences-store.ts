import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import type { BrowserAdapter, StorageAdapter } from "@/browser"
import { COLOR_THEME_IDS, type ColorThemeId } from "@/lib/color-themes"
import {
  ProfileStorageAdapter,
  readProfilePreference,
} from "@/stores/profile-storage"

export type CardLayout = "list" | "grid"
/** Folder ids whose dashboard card shows only its header; absent = open. */
export type CollapsedFolders = Record<string, true>
export type ColorTheme = ColorThemeId

/**
 * How the dashboard draws its cards. The grid's layout, its height estimates
 * and its keyboard model all read these together.
 */
export interface CardDisplay {
  nestedFolders: boolean
  cardLayouts: Record<string, CardLayout>
  collapsedFolders: CollapsedFolders
}

export const COLOR_THEMES: ColorTheme[] = [...COLOR_THEME_IDS]

interface PreferencesState {
  // Source-scoped: keyed to one source's folder ids, read and written
  // through the active source's storage adapter.
  cardLayouts: Record<string, CardLayout>
  collapsedFolders: CollapsedFolders
  folderOrder: string[]
  // Profile-wide: this browser profile's look and feel, independent of the
  // active source. Stored in the fixed profile namespace.
  nestedFolders: boolean
  colorTheme: ColorTheme
  maxColumns: number
  containerMode: "fluid" | "contained"
  experimentalCardDrag: boolean
  isFoldersOnlyEnabledInTreeEditor: boolean
  /**
   * Safe mode: the new tab draws its header and a notice instead of the
   * bookmark grid, so a grid that crashes or hangs on a large tree can be
   * reconfigured from Settings before it is drawn again. Profile-wide, like
   * the look-and-feel preferences: it describes this browser, not a source.
   */
  safeMode: boolean

  // Session state, not preferences.
  adapter: BrowserAdapter | null
  /**
   * Whether the active source's preferences are still loading. The dashboard
   * waits for them: drawn before them, a collapsed card paints open and a
   * toggle made in that window is overwritten when they land.
   */
  isLoading: boolean
  /**
   * Where source-scoped writes go: the active source's storage, once its
   * values have been read. Until then, or when reading failed, nothing is
   * written, so a source's saved values are never overwritten unseen.
   */
  sourceStorage: StorageAdapter | null

  // Actions
  init(
    adapter: BrowserAdapter,
    options?: { isCurrent?: () => boolean }
  ): Promise<void>
  setCardLayout(folderId: string, layout: CardLayout): void
  setFolderCollapsed(folderId: string, collapsed: boolean): void
  setNestedFolders(value: boolean): void
  setColorTheme(theme: ColorTheme): void
  setMaxColumns(value: number): void
  setContainerMode(mode: "fluid" | "contained"): void
  setFolderOrder(order: string[]): void
  setExperimentalCardDrag(value: boolean): void
  setIsFoldersOnlyEnabledInTreeEditor(value: boolean): void
  /** Resolves once the value is persisted, so a reload can follow it. */
  setSafeMode(value: boolean): Promise<void>
}

/** One profile-wide store for the whole session; never re-created per source. */
const profileStorage = new ProfileStorageAdapter()

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  cardLayouts: {},
  collapsedFolders: {},
  nestedFolders: false,
  colorTheme: "default",
  maxColumns: 4,
  containerMode: "contained",
  folderOrder: [],
  experimentalCardDrag: false,
  isFoldersOnlyEnabledInTreeEditor: true,
  safeMode: false,
  adapter: null,
  isLoading: true,
  sourceStorage: null,

  async init(adapter: BrowserAdapter, options = {}) {
    // See bookmark-store.init: a superseded Source Session transition must
    // not apply its (source-scoped) preferences over the newer session's.
    const isCurrent = options.isCurrent ?? (() => true)
    if (!isCurrent()) return
    set({ adapter, isLoading: true, sourceStorage: null })

    const [
      cardLayouts,
      collapsedFolders,
      nestedFolders,
      colorTheme,
      maxColumns,
      containerMode,
      folderOrder,
      experimentalCardDrag,
      isFoldersOnlyEnabledInTreeEditor,
      safeMode,
    ] = await Promise.all([
      adapter.storage.get<Record<string, CardLayout>>("cardLayouts"),
      adapter.storage.get<CollapsedFolders>("collapsedFolders"),
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
      readProfilePreference<boolean>("safeMode", adapter.storage),
    ]).catch((error: unknown) => {
      // Without this source's values, its cards start from the defaults
      // rather than the previous source's, `sourceStorage` stays unset so
      // nothing is written over what it saved, and the dashboard is not held
      // on its loading state. The failure still reaches the transition.
      if (isCurrent()) {
        set({
          cardLayouts: {},
          collapsedFolders: {},
          folderOrder: [],
          isLoading: false,
        })
      }
      throw error
    })

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
    const isFreshSourceState = cardLayouts === null && folderOrder === null

    let seedPrefDefaults: Record<string, unknown> | null = null
    if (import.meta.env.DEV && (isFreshState || isFreshSourceState)) {
      // The marketing preview applies its URL theme before source bootstrap,
      // so profile-wide state may already be hydrated while source defaults
      // still need to come from the deterministic development seed.
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
      collapsedFolders: collapsedFolders ?? {},
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
      safeMode: safeMode ?? false,
      isLoading: false,
      sourceStorage: adapter.storage,
    })

    // Apply color theme to root element
    applyColorTheme(resolvedColorTheme)
  },

  setCardLayout(folderId: string, layout: CardLayout) {
    const { cardLayouts, sourceStorage } = get()
    const updated = { ...cardLayouts, [folderId]: layout }
    set({ cardLayouts: updated })
    sourceStorage?.set("cardLayouts", updated)
  },

  setFolderCollapsed(folderId: string, collapsed: boolean) {
    const { collapsedFolders, sourceStorage } = get()
    // An open card is the default, so expanding drops the entry rather than
    // storing `false` for every folder that was ever collapsed.
    const updated = { ...collapsedFolders }
    if (collapsed) updated[folderId] = true
    else delete updated[folderId]
    set({ collapsedFolders: updated })
    sourceStorage?.set("collapsedFolders", updated)
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
    get().sourceStorage?.set("folderOrder", order)
  },

  setExperimentalCardDrag(value: boolean) {
    set({ experimentalCardDrag: value })
    void profileStorage.set("experimentalCardDrag", value)
  },

  setIsFoldersOnlyEnabledInTreeEditor(value: boolean) {
    set({ isFoldersOnlyEnabledInTreeEditor: value })
    void profileStorage.set("isFoldersOnlyEnabledInTreeEditor", value)
  },

  async setSafeMode(value: boolean) {
    set({ safeMode: value })
    await profileStorage.set("safeMode", value)
  },
}))

/**
 * The card display preferences as one object, whose identity only changes
 * when one of them does — so it can sit in memo dependencies directly.
 */
export function useCardDisplay(): CardDisplay {
  return usePreferencesStore(
    useShallow((s) => ({
      nestedFolders: s.nestedFolders,
      cardLayouts: s.cardLayouts,
      collapsedFolders: s.collapsedFolders,
    }))
  )
}

function applyColorTheme(theme: ColorTheme) {
  const root = document.documentElement
  if (theme === "default") {
    root.removeAttribute("data-color-theme")
  } else {
    root.setAttribute("data-color-theme", theme)
  }
}
