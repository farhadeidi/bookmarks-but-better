// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { useUIStore } from "@/stores/ui-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useSourceStore } from "@/stores/source-store"
import { emptySourceConfig } from "@/sources/config"
import { SettingsDialog } from "../settings-dialog"

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

installFakeIndexedDB()

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver)
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  useUIStore.setState({ settingsOpen: true })
  useBookmarkStore.setState({ tree: [], rootFolderId: null })
  useSourceStore.setState({
    status: "ready",
    switching: false,
    lastSwitchError: null,
    config: { ...emptySourceConfig(), sources: { browser: { enabled: true } } },
    activeSourceId: "browser",
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

function openSourcesCategory() {
  fireEvent.click(screen.getByRole("tab", { name: "Sources" }))
}

describe("SettingsDialog Sources category", () => {
  it("offers the daemon connection UI on a desktop user agent", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      platform: "Linux x86_64",
    })

    render(<SettingsDialog />)
    openSourcesCategory()

    expect(screen.getByLabelText("Daemon address")).toBeTruthy()
  })

  it("hides the daemon connection UI entirely on a mobile user agent", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0",
      platform: "Linux armv8l",
    })

    render(<SettingsDialog />)
    openSourcesCategory()

    expect(screen.queryByLabelText("Daemon address")).toBeNull()
  })

  it("shows the browser source with its enabled state and active marker", () => {
    render(<SettingsDialog />)
    openSourcesCategory()

    expect(screen.getByText("Browser bookmarks")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Active" })).toBeTruthy()
    expect(screen.getByText("Root folder")).toBeTruthy()
    expect(screen.getByText("Nested folders")).toBeTruthy()
  })

  it("never offers Standalone to a profile that never used it", () => {
    render(<SettingsDialog />)
    openSourcesCategory()

    expect(screen.queryByText(/Standalone/)).toBeNull()
  })
})

describe("SettingsDialog categories", () => {
  it("renders every agreed category in the navigation", () => {
    render(<SettingsDialog />)

    for (const label of [
      "General",
      "Sources",
      "Appearance",
      "Data & Migration",
      "Advanced",
      "About",
    ]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy()
    }
    expect(screen.queryByRole("tab", { name: "Bookmarks" })).toBeNull()
  })
})
