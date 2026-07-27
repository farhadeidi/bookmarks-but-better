// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import App from "../App"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BrowserAdapter } from "@/browser"

vi.mock("@/browser", () => ({
  detectAdapter: vi.fn(),
}))

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
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
    capabilities: { openInManager: false, reorder: false },
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

    const { detectAdapter } = await import("@/browser")
    vi.mocked(detectAdapter).mockResolvedValue(adapter)

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
