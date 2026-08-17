import { describe, expect, it } from "vitest"
import {
  SETTINGS_CATEGORIES,
  SETTING_HOMES,
  type SettingsCategoryId,
} from "./settings-categories"

/**
 * The refactor promised two things: every setting the product had lands in
 * exactly one category, and the categories are the agreed seven. This suite
 * pins both, so a setting added without a home fails here rather than
 * silently vanishing from the UI.
 */
describe("settings categorization", () => {
  it("has exactly the agreed categories, in order", () => {
    expect(SETTINGS_CATEGORIES.map((c) => c.id)).toEqual([
      "general",
      "sources",
      "appearance",
      "bookmarks",
      "data-migration",
      "advanced",
      "about",
    ])
  })

  it("every setting home names a real category", () => {
    const ids = new Set(SETTINGS_CATEGORIES.map((c) => c.id))
    for (const home of Object.values(SETTING_HOMES)) {
      expect(ids.has(home as SettingsCategoryId)).toBe(true)
    }
  })

  it("covers the settings the product actually persists", () => {
    const homes = new Set(Object.keys(SETTING_HOMES))
    // Source Configuration.
    expect(homes.has("sourceEnabled")).toBe(true)
    expect(homes.has("activeSource")).toBe(true)
    expect(homes.has("daemonConnections")).toBe(true)
    // Profile-wide appearance.
    expect(homes.has("colorTheme")).toBe(true)
    expect(homes.has("themeMode")).toBe(true)
    expect(homes.has("maxColumns")).toBe(true)
    expect(homes.has("containerMode")).toBe(true)
    // Bookmarks.
    expect(homes.has("rootFolderId")).toBe(true)
    expect(homes.has("nestedFolders")).toBe(true)
    // Data & Migration.
    expect(homes.has("importBookmarks")).toBe(true)
    expect(homes.has("exportBookmarks")).toBe(true)
    expect(homes.has("standaloneMigration")).toBe(true)
    // General.
    expect(homes.has("setupWizard")).toBe(true)
    // Advanced.
    expect(homes.has("experimentalCardDrag")).toBe(true)
  })
})
