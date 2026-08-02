// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { RootFolderSelect } from "./root-folder-select"

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const VAULT: BookmarkNode[] = [
  {
    id: "vault-root",
    title: "Bookmarks",
    children: [{ id: "work", title: "Work", children: [] }],
  },
]

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
  useBookmarkStore.setState({ tree: VAULT })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function label(): string {
  return screen.getByRole("combobox").textContent ?? ""
}

describe("RootFolderSelect display label", () => {
  it("names a real folder by its path", () => {
    render(<RootFolderSelect value="work" onChange={vi.fn()} />)

    expect(label()).toBe("Bookmarks > Work")
  })

  it("shows the root label when nothing is selected", () => {
    render(<RootFolderSelect value={null} onChange={vi.fn()} />)

    expect(label()).toBe("Browser Root (all bookmarks)")
  })

  it("shows the root label for an adapter whose tree root is selectable, not its raw id", () => {
    // Daemon and standalone hand back a real root node, which the options list
    // deliberately omits — selecting it means the same as selecting nothing.
    render(<RootFolderSelect value="vault-root" onChange={vi.fn()} />)

    expect(label()).toBe("Browser Root (all bookmarks)")
  })

  it("says a folder is gone rather than printing its id", () => {
    render(<RootFolderSelect value="deleted-folder" onChange={vi.fn()} />)

    expect(label()).toBe("Unavailable folder — using the default")
  })
})
