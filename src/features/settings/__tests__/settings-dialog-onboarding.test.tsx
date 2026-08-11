// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { SettingsDialog } from "../settings-dialog"
import { getOnboardingCompleted } from "@/browser/onboarding-preference"

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

installFakeIndexedDB()

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver)
  useUIStore.setState({
    settingsOpen: true,
    onboardingOpen: false,
  })
  usePreferencesStore.setState({ adapterMode: "browser" })
  useBookmarkStore.setState({ tree: [], rootFolderId: null })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

describe("SettingsDialog setup wizard", () => {
  it("clears onboardingCompleted, closes settings, and opens the wizard", async () => {
    const storageSet = vi.fn().mockResolvedValue(undefined)
    useBookmarkStore.setState({
      adapter: {
        bookmarks: {} as never,
        storage: {
          get: vi.fn().mockResolvedValue(null),
          set: storageSet,
          remove: vi.fn(),
        },
        favicon: { getUrl: vi.fn(), isAvailable: vi.fn(() => false) },
        capabilities: {
          openInManager: false,
          move: true,
          reorder: true,
          setChildOrder: false,
        },
      },
    })

    render(<SettingsDialog />)

    fireEvent.click(screen.getByRole("button", { name: "Show setup wizard" }))

    expect(storageSet).toHaveBeenCalledWith("onboardingCompleted", false)
    await vi.waitFor(async () => {
      expect(await getOnboardingCompleted()).toBe(false)
    })
    await vi.waitFor(() => {
      expect(useUIStore.getState().settingsOpen).toBe(false)
      expect(useUIStore.getState().onboardingOpen).toBe(true)
    })
  })
})
