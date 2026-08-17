/**
 * The settings categories. One list, consumed by the navigation and by the
 * categorization test that proves every setting has exactly one home.
 */

export type SettingsCategoryId =
  | "general"
  | "sources"
  | "appearance"
  | "bookmarks"
  | "data-migration"
  | "advanced"
  | "about"

export interface SettingsCategory {
  id: SettingsCategoryId
  label: string
  description: string
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "general",
    label: "General",
    description: "Setup and first-run basics.",
  },
  {
    id: "sources",
    label: "Sources",
    description: "Where your bookmarks come from.",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, colors and layout width.",
  },
  {
    id: "bookmarks",
    label: "Bookmarks",
    description: "Root folder and folder display.",
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
  // Bookmarks
  rootFolderId: "bookmarks",
  nestedFolders: "bookmarks",
  // Data & Migration
  importBookmarks: "data-migration",
  exportBookmarks: "data-migration",
  standaloneMigration: "data-migration",
  // General
  setupWizard: "general",
  // Advanced
  experimentalCardDrag: "advanced",
}
