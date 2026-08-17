// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import App from "../App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BrowserAdapter } from "@/browser"

vi.mock("@/sources/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/adapters")>()
  return {
    ...actual,
    createAdapterForSource: vi.fn(),
  }
})

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

installFakeIndexedDB()

beforeEach(() => {
  installFakeIndexedDB()
  vi.stubGlobal("chrome", {
    bookmarks: {},
    storage: {
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
      sync: { get: vi.fn().mockResolvedValue({}) },
    },
  })
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  vi.stubGlobal("ResizeObserver", StubResizeObserver)
})

function createMockAdapter(): BrowserAdapter {
  return {
    bookmarks: {
      getTree: vi.fn(),
      getSubTree: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      onChanged: vi.fn(() => () => {}),
      onCreated: vi.fn(() => () => {}),
      onRemoved: vi.fn(() => () => {}),
      onMoved: vi.fn(() => () => {}),
      openInManager: vi.fn(),
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
    capabilities: {
      openInManager: false,
      move: true,
      reorder: false,
      setChildOrder: false,
    },
  }
}

function renderApp() {
  return render(
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("App daemon-unavailable state", () => {
  it("shows an unavailable panel with the error and a working Retry that recovers once the daemon answers", async () => {
    const adapter = createMockAdapter()
    let attempt = 0
    vi.mocked(adapter.bookmarks.getTree).mockImplementation(() => {
      attempt += 1
      if (attempt === 1) {
        return Promise.reject(new Error("Failed to fetch"))
      }
      return Promise.resolve([{ id: "root", title: "Root", children: [] }])
    })

    const { createAdapterForSource } = await import("@/sources/adapters")
    vi.mocked(createAdapterForSource).mockReturnValue(adapter)

    // The persisted source configuration says browser is active and enabled.
    const { useSourceStore, resetSourceSession } =
      await import("@/stores/source-store")
    const { emptySourceConfig } = await import("@/sources/config")
    resetSourceSession()
    useSourceStore.setState({
      status: "loading",
      switching: false,
      lastSwitchError: null,
      config: {
        ...emptySourceConfig(),
        sources: { browser: { enabled: true } },
        activeSourceId: "browser",
      },
      activeSourceId: "browser",
    })

    renderApp()

    await waitFor(() => {
      expect(screen.getByText("Bookmarks are unavailable.")).toBeTruthy()
    })
    expect(screen.getByText("Failed to fetch")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() => {
      expect(useBookmarkStore.getState().status).toBe("ready")
    })
    expect(screen.queryByText("Bookmarks are unavailable.")).toBeNull()
    expect(adapter.bookmarks.getTree).toHaveBeenCalledTimes(2)
  })
})
