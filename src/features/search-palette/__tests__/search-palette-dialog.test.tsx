// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { SearchPaletteDialog } from "../search-palette-dialog"
import { openResultUrl } from "../open-result"

// Only the navigation itself is stubbed: which URLs may be followed is a rule
// worth exercising through the real thing.
vi.mock("../open-result", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../open-result")>()),
  openResultUrl: vi.fn(),
}))

const TREE: BookmarkNode[] = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "bar",
        title: "Bookmarks Bar",
        children: [
          {
            id: "dev",
            title: "Dev",
            children: [
              { id: "github", title: "GitHub", url: "https://github.com" },
            ],
          },
          {
            id: "scripts",
            title: "Scripts",
            children: [
              { id: "legacy", title: "Legacy tool", url: "javascript:void 0" },
            ],
          },
        ],
      },
    ],
  },
]

function openPalette(seedQuery = "") {
  useUIStore.setState({ searchPalette: { seedQuery }, organizerRevealId: null })
}

function searchInput(): HTMLInputElement {
  return screen.getByRole("combobox", { name: "Search bookmarks" })
}

function highlightedOption(): HTMLElement | undefined {
  return screen
    .getAllByRole("option")
    .find((option) => option.getAttribute("aria-selected") === "true")
}

describe("SearchPaletteDialog", () => {
  beforeEach(() => {
    vi.mocked(openResultUrl).mockClear()
    useBookmarkStore.setState({ tree: TREE })
    openPalette()
    render(<SearchPaletteDialog />)
  })

  afterEach(() => {
    cleanup()
    useUIStore.setState({ searchPalette: null, organizerRevealId: null })
  })

  it("starts from the character that opened it", () => {
    cleanup()
    openPalette("g")
    render(<SearchPaletteDialog />)

    expect(searchInput().value).toBe("g")
    expect(screen.getAllByRole("option")[0].textContent).toContain("GitHub")
  })

  it("puts focus in the search box, since the next character is the query", async () => {
    await waitFor(() => expect(document.activeElement).toBe(searchInput()))
  })

  it("says where each hit lives, since the scope is the whole source", () => {
    fireEvent.change(searchInput(), { target: { value: "github" } })

    expect(screen.getByRole("option").textContent).toContain(
      "Bookmarks Bar > Dev"
    )
  })

  it("moves the highlight with the arrow keys, staying in the input", () => {
    fireEvent.change(searchInput(), { target: { value: "e" } })
    const options = screen.getAllByRole("option")
    expect(options.length).toBeGreaterThan(1)
    expect(highlightedOption()).toBe(options[0])

    fireEvent.keyDown(searchInput(), { key: "ArrowDown" })
    expect(highlightedOption()).toBe(screen.getAllByRole("option")[1])
    expect(searchInput().getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[1].id
    )

    fireEvent.keyDown(searchInput(), { key: "ArrowUp" })
    expect(highlightedOption()).toBe(screen.getAllByRole("option")[0])
  })

  it("opens the highlighted result in this tab on Enter, and closes", () => {
    fireEvent.change(searchInput(), { target: { value: "github" } })
    fireEvent.keyDown(searchInput(), { key: "Enter" })

    expect(openResultUrl).toHaveBeenCalledWith("https://github.com/", {
      background: false,
    })
    expect(useUIStore.getState().searchPalette).toBeNull()
  })

  it("opens in a background tab on Ctrl or Command Enter, and stays open", () => {
    fireEvent.change(searchInput(), { target: { value: "github" } })
    fireEvent.keyDown(searchInput(), { key: "Enter", metaKey: true })

    expect(openResultUrl).toHaveBeenCalledWith("https://github.com/", {
      background: true,
    })
    // The user is still here: opening several in a row is the point.
    expect(useUIStore.getState().searchPalette).not.toBeNull()
  })

  it("reveals a folder instead of navigating, since it has nowhere to go", () => {
    fireEvent.change(searchInput(), { target: { value: "scripts" } })
    fireEvent.keyDown(searchInput(), { key: "Enter" })

    expect(openResultUrl).not.toHaveBeenCalled()
    expect(useUIStore.getState().organizerRevealId).toBe("scripts")
    expect(useUIStore.getState().bookmarkOrganizerOpen).toBe(true)
  })

  it("reveals a bookmark whose URL this page must not follow", () => {
    fireEvent.change(searchInput(), { target: { value: "legacy" } })
    fireEvent.keyDown(searchInput(), { key: "Enter" })

    expect(openResultUrl).not.toHaveBeenCalled()
    expect(useUIStore.getState().organizerRevealId).toBe("legacy")
  })

  it("reveals the highlighted result from the footer action", () => {
    fireEvent.change(searchInput(), { target: { value: "github" } })
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reveal GitHub in Bookmark Organizer",
      })
    )

    expect(useUIStore.getState().organizerRevealId).toBe("github")
    expect(useUIStore.getState().searchPalette).toBeNull()
  })

  it("says so when nothing matches, and offers nothing to open", () => {
    fireEvent.change(searchInput(), { target: { value: "nothing here" } })

    expect(screen.queryAllByRole("option")).toHaveLength(0)
    expect(screen.getByText("Nothing in this source matches.")).toBeTruthy()

    fireEvent.keyDown(searchInput(), { key: "Enter" })
    expect(openResultUrl).not.toHaveBeenCalled()
  })

  it("shows nothing at all for an empty query", () => {
    expect(screen.queryAllByRole("option")).toHaveLength(0)
    expect(screen.getByText("Type to search this source.")).toBeTruthy()
  })
})
