// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { usePreferencesStore } from "@/stores/preferences-store"
import { ProfileStorageAdapter } from "@/stores/profile-storage"
import { useUIStore } from "@/stores/ui-store"
import { GridErrorBoundary } from "../grid-error-boundary"

function Thrower({ message }: { message: string }): never {
  throw new Error(message)
}

beforeEach(() => {
  installFakeIndexedDB()
  useUIStore.setState({ settingsOpen: false })
  usePreferencesStore.setState({ safeMode: false })
  // React reports every caught render error to the console; the boundary
  // catching it is the point of these tests.
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("GridErrorBoundary", () => {
  it("renders the fallback with the error text instead of blanking the page", () => {
    render(
      <GridErrorBoundary>
        <Thrower message="Maximum call stack size exceeded" />
      </GridErrorBoundary>
    )

    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("The bookmark grid could not be drawn.")
    expect(screen.getByText("Maximum call stack size exceeded")).toBeTruthy()
  })

  it("renders its children when nothing throws", () => {
    render(
      <GridErrorBoundary>
        <p>the grid</p>
      </GridErrorBoundary>
    )

    expect(screen.getByText("the grid")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("Open Settings opens the settings dialog", () => {
    render(
      <GridErrorBoundary>
        <Thrower message="boom" />
      </GridErrorBoundary>
    )

    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }))

    expect(useUIStore.getState().settingsOpen).toBe(true)
  })

  it("Reload in safe mode persists the preference before reloading", async () => {
    const reload = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    })

    render(
      <GridErrorBoundary>
        <Thrower message="boom" />
      </GridErrorBoundary>
    )

    fireEvent.click(screen.getByRole("button", { name: "Reload in safe mode" }))

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1)
    })
    expect(usePreferencesStore.getState().safeMode).toBe(true)
    expect(await new ProfileStorageAdapter().get<boolean>("safeMode")).toBe(
      true
    )
  })
})
