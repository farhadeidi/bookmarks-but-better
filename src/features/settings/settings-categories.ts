/**
 * The settings categories. One list, consumed by the navigation and by the
 * categorization test that proves every setting has exactly one home.
 */

export type SettingsCategoryId =
  | "general"
  | "sources"
  | "appearance"
  | "data-migration"
  | "advanced"
  | "about"

export interface SettingsCategory {
  id: SettingsCategoryId
  label: string
  description: string
}

// Sources first: it is the one category that decides what the dashboard shows
// at all, and the one a person opens Settings for most often.
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "sources",
    label: "Sources",
    description: "Where your bookmarks come from.",
  },
  {
    id: "general",
    label: "General",
    description: "Setup and first-run basics.",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, colors and layout width.",
  },
  {
    id: "data-migration",
    label: "Data & Migration",
    description: "Import, export and legacy data.",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Experimental behaviour.",
  },
  {
    id: "about",
    label: "About",
    description: "Version and links.",
  },
] as const

/** Every persisted setting key and the one category it lives in. */
export const SETTING_HOMES: Record<string, SettingsCategoryId> = {
  // Sources
  sourceEnabled: "sources",
  activeSource: "sources",
  daemonConnections: "sources",
  // Appearance
  colorTheme: "appearance",
  themeMode: "appearance",
  maxColumns: "appearance",
  containerMode: "appearance",
  rootFolderId: "sources",
  nestedFolders: "sources",
  folderTiles: "sources",
  // Data & Migration
  importBookmarks: "data-migration",
  exportBookmarks: "data-migration",
  standaloneMigration: "data-migration",
  // General
  setupWizard: "general",
  safeMode: "general",
  // Advanced
  experimentalCardDrag: "advanced",
}
