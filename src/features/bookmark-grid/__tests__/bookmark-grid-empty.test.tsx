// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import { BookmarkGrid } from "../bookmark-grid"

function mount(
  rootFolderId: string | null,
  tree = [{ id: "0", title: "", children: [] }],
  rootIsCreatable = false
) {
  useBookmarkStore.setState({
    adapter: {
      bookmarks: {} as never,
      storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      favicon: { getUrl: () => "", isAvailable: () => false },
      capabilities: {
        openInManager: false,
        move: true,
        reorder: true,
        setChildOrder: false,
        rootIsCreatable,
      },
    },
    tree,
    rootFolder: rootFolderId ? tree[0] : null,
    rootFolderId,
    isLoading: false,
  })
  usePreferencesStore.setState({
    experimentalCardDrag: false,
    nestedFolders: false,
    folderOrder: [],
    cardLayouts: {},
    maxColumns: 4,
    containerMode: "fluid",
  })
  return render(<BookmarkGrid />)
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("BookmarkGrid empty state", () => {
  it("offers create actions when a root folder is selected", () => {
    mount("0")

    expect(screen.getByRole("button", { name: /New Folder/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /New Bookmark/ })).toBeTruthy()
  })

  it("offers only an explanation and Open Settings when no root folder is selected", () => {
    mount(null)

    expect(screen.queryByRole("button", { name: /New Folder/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /New Bookmark/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy()
  })

  it("opens Settings from the no-root explanation", () => {
    const openSettings = vi.fn()
    useUIStore.setState({ openSettings })
    mount(null)

    screen.getByRole("button", { name: "Open Settings" }).click()

    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  it("offers create actions against the vault root when no root folder is chosen but the adapter allows it (daemon, standalone)", () => {
    mount(null, [{ id: "vault-root", title: "Vault", children: [] }], true)

    expect(screen.getByRole("button", { name: /New Folder/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /New Bookmark/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Open Settings" })).toBeNull()
  })
})
