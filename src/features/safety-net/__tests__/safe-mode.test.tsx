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
import App from "@/App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ProfileStorageAdapter } from "@/stores/profile-storage"
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const TREE = [
  {
    id: "root",
    title: "Root",
    children: [
      {
        id: "work",
        title: "Work folder",
        children: [{ id: "b1", title: "Issue tracker", url: "https://x.test" }],
      },
    ],
  },
]

function createMockAdapter(): BrowserAdapter {
  return {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue(TREE),
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

async function renderAppWithBrowserSource() {
  const { createAdapterForSource } = await import("@/sources/adapters")
  vi.mocked(createAdapterForSource).mockReturnValue(createMockAdapter())

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

  return render(
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  )
}

describe("App safe mode", () => {
  it("shows the notice instead of the grid while the persisted preference is on, and draws the grid once it is turned off", async () => {
    await new ProfileStorageAdapter().set("safeMode", true)

    await renderAppWithBrowserSource()

    await waitFor(() => {
      expect(
        screen.getByText("Safe mode is on: bookmarks are not rendered.")
      ).toBeTruthy()
    })
    expect(screen.queryByText("Work folder")).toBeNull()
    // The way into Settings is still there.
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Turn safe mode off" }))

    await waitFor(() => {
      expect(screen.getByText("Work folder")).toBeTruthy()
    })
    expect(
      screen.queryByText("Safe mode is on: bookmarks are not rendered.")
    ).toBeNull()
    expect(await new ProfileStorageAdapter().get<boolean>("safeMode")).toBe(
      false
    )
  })

  it("draws the grid when the preference is off", async () => {
    await renderAppWithBrowserSource()

    await waitFor(() => {
      expect(screen.getByText("Work folder")).toBeTruthy()
    })
    expect(
      screen.queryByText("Safe mode is on: bookmarks are not rendered.")
    ).toBeNull()
  })
})
