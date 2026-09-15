// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { ThemeProvider } from "@/components/theme-provider"
import { useSearchTypeAhead } from "@/features/search-palette/use-search-type-ahead"
import { useUIStore } from "@/stores/ui-store"

/**
 * Type-ahead search owns every printable character on the dashboard, so the
 * theme must not also answer to one. "d" once did both: it started a search
 * and flipped light and dark.
 */
function Dashboard() {
  useSearchTypeAhead()
  return <button type="button">Somewhere on the dashboard</button>
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    localStorage.setItem("theme", "dark")
    useUIStore.setState({ searchPalette: null })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.documentElement.className = ""
    useUIStore.setState({ searchPalette: null })
  })

  it("leaves the theme alone when typing d starts a search", () => {
    render(
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>
    )

    fireEvent.keyDown(document.body, { key: "d" })

    expect(useUIStore.getState().searchPalette?.seedQuery).toBe("d")
    expect(localStorage.getItem("theme")).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })
})
