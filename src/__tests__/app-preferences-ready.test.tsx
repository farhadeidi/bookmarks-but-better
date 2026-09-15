// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import App from "@/App"
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

describe("App before the source's preferences load", () => {
  it("waits for them, so a collapsed card is never drawn open", async () => {
    let releaseCollapsed: (value: Record<string, true>) => void = () => {}
    const collapsed = new Promise<Record<string, true>>((resolve) => {
      releaseCollapsed = resolve
    })

    const adapter: BrowserAdapter = {
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
        get: vi.fn((key: string) =>
          key === "collapsedFolders" ? collapsed : Promise.resolve(null)
        ) as BrowserAdapter["storage"]["get"],
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

    const { createAdapterForSource } = await import("@/sources/adapters")
    vi.mocked(createAdapterForSource).mockReturnValue(adapter)
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

    render(
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    )

    // The bookmarks are in, but the preferences are not: no grid yet.
    await waitFor(() => {
      expect(useBookmarkStore.getState().isLoading).toBe(false)
    })
    expect(screen.getByText("Loading bookmarks...")).toBeTruthy()
    expect(screen.queryByText("Work folder")).toBeNull()

    releaseCollapsed({ work: true })

    // The first grid drawn already has the card closed.
    await waitFor(() => {
      expect(screen.getByText("Work folder")).toBeTruthy()
    })
    expect(screen.getByRole("button", { name: "Expand folder" })).toBeTruthy()
    expect(screen.queryByText("Issue tracker")).toBeNull()
  })
})
