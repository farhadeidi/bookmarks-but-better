// @vitest-environment jsdom

import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, waitFor, cleanup } from "@testing-library/react"
import { useAppBootstrap } from "./use-app-bootstrap"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import {
  getOnboardingCompleted,
  setOnboardingCompleted,
} from "@/browser/onboarding-preference"
import type { BrowserAdapter } from "@/browser"

vi.mock("@/browser", () => ({
  detectAdapter: vi.fn(),
}))

installFakeIndexedDB()

function createMockAdapter(legacyOnboardingCompleted: boolean | null = null) {
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
      get: vi
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(
            key === "onboardingCompleted" ? legacyOnboardingCompleted : null
          )
        ),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    favicon: {
      getUrl: vi.fn(),
      isAvailable: vi.fn().mockReturnValue(false),
    },
    capabilities: {
      openInManager: false,
      move: true,
      reorder: true,
      setChildOrder: false,
    },
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

beforeEach(() => {
  installFakeIndexedDB()
  useUIStore.setState({ onboardingOpen: false })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  installFakeIndexedDB()
})

describe("useAppBootstrap", () => {
  it("migrates a completed v2-v3 setup and does not reopen onboarding", async () => {
    const { adapter } = createMockAdapter(true)
    const { detectAdapter } = await import("@/browser")
    vi.mocked(detectAdapter).mockResolvedValue(adapter)

    render(<Harness />)

    await waitFor(() => {
      expect(adapter.storage.get).toHaveBeenCalledWith("onboardingCompleted")
    })
    await waitFor(async () => {
      expect(await getOnboardingCompleted()).toBe(true)
    })
    expect(useUIStore.getState().onboardingOpen).toBe(false)
  })

  it("keeps onboarding closed after the adapter changes", async () => {
    await setOnboardingCompleted(true)
    const { adapter } = createMockAdapter(null)
    const { detectAdapter } = await import("@/browser")
    vi.mocked(detectAdapter).mockResolvedValue(adapter)

    render(<Harness />)

    await waitFor(() => {
      expect(useBookmarkStore.getState().isLoading).toBe(false)
    })
    expect(adapter.storage.get).not.toHaveBeenCalledWith("onboardingCompleted")
    expect(useUIStore.getState().onboardingOpen).toBe(false)
  })

  it("opens onboarding for a genuinely fresh profile", async () => {
    const { adapter } = createMockAdapter(null)
    const { detectAdapter } = await import("@/browser")
    vi.mocked(detectAdapter).mockResolvedValue(adapter)

    render(<Harness />)

    await waitFor(() => {
      expect(useUIStore.getState().onboardingOpen).toBe(true)
    })
  })

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
