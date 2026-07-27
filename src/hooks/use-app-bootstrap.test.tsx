// @vitest-environment jsdom

import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { render, waitFor, cleanup } from "@testing-library/react"
import { useAppBootstrap } from "./use-app-bootstrap"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BrowserAdapter } from "@/browser"

vi.mock("@/browser", () => ({
  detectAdapter: vi.fn(),
}))

function createMockAdapter() {
  const listeners = {
    changed: new Set<() => void>(),
    created: new Set<() => void>(),
    removed: new Set<() => void>(),
    moved: new Set<() => void>(),
  }

  const adapter: BrowserAdapter = {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([]),
      getSubTree: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      onChanged: vi.fn((cb: () => void) => {
        listeners.changed.add(cb)
        return () => listeners.changed.delete(cb)
      }),
      onCreated: vi.fn((cb: () => void) => {
        listeners.created.add(cb)
        return () => listeners.created.delete(cb)
      }),
      onRemoved: vi.fn((cb: () => void) => {
        listeners.removed.add(cb)
        return () => listeners.removed.delete(cb)
      }),
      onMoved: vi.fn((cb: () => void) => {
        listeners.moved.add(cb)
        return () => listeners.moved.delete(cb)
      }),
      openInManager: vi.fn(),
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    favicon: {
      getUrl: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(false),
    },
    capabilities: { openInManager: false, move: true, reorder: true },
  }

  return { adapter, listeners }
}

function totalListenerCount(
  listeners: ReturnType<typeof createMockAdapter>["listeners"]
) {
  return (
    listeners.changed.size +
    listeners.created.size +
    listeners.removed.size +
    listeners.moved.size
  )
}

function Harness() {
  useAppBootstrap()
  return null
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("useAppBootstrap", () => {
  it("unsubscribes all bookmark listeners on unmount, including under StrictMode double-invoke", async () => {
    const { adapter, listeners } = createMockAdapter()
    const { detectAdapter } = await import("@/browser")
    vi.mocked(detectAdapter).mockResolvedValue(adapter)

    const { unmount } = render(
      <React.StrictMode>
        <Harness />
      </React.StrictMode>
    )

    await waitFor(() => {
      expect(totalListenerCount(listeners)).toBeGreaterThan(0)
    })

    // Give the (StrictMode-cancelled) first bootstrap pass a chance to
    // resolve and clean up after itself before we unmount.
    await waitFor(() => {
      expect(useBookmarkStore.getState().isLoading).toBe(false)
    })

    unmount()

    await waitFor(() => {
      expect(totalListenerCount(listeners)).toBe(0)
    })
  })
})
