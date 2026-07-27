import { describe, expect, it, vi } from "vitest"
import { useBookmarkStore } from "../bookmark-store"
import type { BrowserAdapter } from "@/browser"

function baseAdapter(
  overrides: Partial<BrowserAdapter["bookmarks"]> = {}
): BrowserAdapter {
  return {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([]),
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
      ...overrides,
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
    capabilities: { openInManager: false, move: true, reorder: false },
  }
}

describe("bookmark-store health-gated readiness", () => {
  it("retry() treats an unready health check as unavailable, surfacing its warnings, without calling getTree()", async () => {
    const getTree = vi.fn().mockResolvedValue([])
    const checkHealth = vi.fn().mockResolvedValue({
      ready: false,
      warnings: ["Vault is being rescanned."],
    })
    const adapter = baseAdapter({ getTree, checkHealth })
    useBookmarkStore.setState({ adapter, status: "loading", loadError: null })

    await useBookmarkStore.getState().retry()

    expect(checkHealth).toHaveBeenCalledTimes(1)
    expect(getTree).not.toHaveBeenCalled()
    expect(useBookmarkStore.getState().status).toBe("unavailable")
    expect(useBookmarkStore.getState().loadError).toBe(
      "Vault is being rescanned."
    )
  })

  it("retry() proceeds to getTree() once health reports ready", async () => {
    const getTree = vi.fn().mockResolvedValue([{ id: "root", title: "Root" }])
    const checkHealth = vi.fn().mockResolvedValue({ ready: true })
    const adapter = baseAdapter({ getTree, checkHealth })
    useBookmarkStore.setState({
      adapter,
      status: "loading",
      loadError: null,
      rootFolderId: null,
    })

    await useBookmarkStore.getState().retry()

    expect(getTree).toHaveBeenCalledTimes(1)
    expect(useBookmarkStore.getState().status).toBe("ready")
  })

  it("skips the health check entirely for adapters that don't implement it (chrome/firefox/standalone)", async () => {
    const getTree = vi.fn().mockResolvedValue([])
    const adapter = baseAdapter({ getTree })
    useBookmarkStore.setState({ adapter, status: "loading", loadError: null })

    await useBookmarkStore.getState().retry()

    expect(getTree).toHaveBeenCalledTimes(1)
    expect(useBookmarkStore.getState().status).toBe("ready")
  })
})
