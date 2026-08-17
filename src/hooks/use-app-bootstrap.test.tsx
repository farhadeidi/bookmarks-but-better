// @vitest-environment jsdom

import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, waitFor, cleanup } from "@testing-library/react"
import { useAppBootstrap } from "./use-app-bootstrap"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { useSourceStore, resetSourceSession } from "@/stores/source-store"
import { emptySourceConfig } from "@/sources/config"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import {
  getOnboardingCompleted,
  setOnboardingCompleted,
} from "@/browser/onboarding-preference"
import type { BrowserAdapter } from "@/browser"

vi.mock("@/sources/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/adapters")>()
  return {
    ...actual,
    createAdapterForSource: vi.fn(),
  }
})

const { createAdapterForSource } = await import("@/sources/adapters")

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
  // A desktop extension context: the fresh profile's Browser Source must
  // survive normalization for these bootstraps to have a source at all.
  vi.stubGlobal("chrome", {
    bookmarks: {},
    storage: {
      local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
      sync: { get: vi.fn().mockResolvedValue({}) },
    },
  })
  useUIStore.setState({ onboardingOpen: false })
  // The source store's session is module-global; every test starts a fresh
  // one over a browser-source config.
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
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

describe("useAppBootstrap", () => {
  it("migrates a completed v2-v3 setup and does not reopen onboarding", async () => {
    const { adapter } = createMockAdapter(true)
    vi.mocked(createAdapterForSource).mockReturnValue(adapter)

    render(<Harness />)

    await waitFor(() => {
      expect(adapter.storage.get).toHaveBeenCalledWith("onboardingCompleted")
    })
    await waitFor(async () => {
      expect(await getOnboardingCompleted()).toBe(true)
    })
    expect(useUIStore.getState().onboardingOpen).toBe(false)
  })

  it("keeps onboarding closed after the source changes", async () => {
    await setOnboardingCompleted(true)
    const { adapter } = createMockAdapter(null)
    vi.mocked(createAdapterForSource).mockReturnValue(adapter)

    render(<Harness />)

    await waitFor(() => {
      expect(useBookmarkStore.getState().isLoading).toBe(false)
    })
    expect(adapter.storage.get).not.toHaveBeenCalledWith("onboardingCompleted")
    expect(useUIStore.getState().onboardingOpen).toBe(false)
  })

  it("opens onboarding for a genuinely fresh profile", async () => {
    const { adapter } = createMockAdapter(null)
    vi.mocked(createAdapterForSource).mockReturnValue(adapter)

    render(<Harness />)

    await waitFor(() => {
      expect(useUIStore.getState().onboardingOpen).toBe(true)
    })
  })

  it("a StrictMode double-invoke initializes exactly one session, not two", async () => {
    const { adapter, listeners } = createMockAdapter()
    vi.mocked(createAdapterForSource).mockReturnValue(adapter)

    render(
      <React.StrictMode>
        <Harness />
      </React.StrictMode>
    )

    await waitFor(() => {
      expect(useBookmarkStore.getState().isLoading).toBe(false)
    })
    // Subscriptions land in the same microtask chain that clears isLoading;
    // wait for them explicitly rather than asserting a mid-flight moment.
    await waitFor(() => {
      expect(totalListenerCount(listeners)).toBeGreaterThan(0)
    })

    // One session means one set of subscriptions, not one per effect invoke:
    // the second pass awaits the first's single-flight initialization.
    expect(totalListenerCount(listeners)).toBe(4)
  })
})
