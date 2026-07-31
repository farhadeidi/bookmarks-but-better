// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { SettingsDialog } from "../settings-dialog"

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

installFakeIndexedDB()

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver)
  useUIStore.setState({ settingsOpen: true })
  usePreferencesStore.setState({ adapterMode: "browser" })
  useBookmarkStore.setState({ tree: [], rootFolderId: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

describe("SettingsDialog daemon source", () => {
  it("offers a Daemon option on a desktop user agent", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    })

    render(<SettingsDialog />)

    expect(screen.getByRole("button", { name: "Daemon" })).toBeTruthy()
  })

  it("hides the Daemon option entirely on a mobile user agent", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0",
    })

    render(<SettingsDialog />)

    expect(screen.queryByRole("button", { name: "Daemon" })).toBeNull()
  })

  it("reveals the connection panel on click without persisting the mode yet", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    })

    render(<SettingsDialog />)

    expect(screen.queryByLabelText("Daemon address")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Daemon" }))

    expect(screen.getByLabelText("Daemon address")).toBeTruthy()
    // Selecting the option only reveals the panel — persisting happens
    // exclusively through its Connect flow.
    expect(usePreferencesStore.getState().adapterMode).toBe("browser")
  })
})
