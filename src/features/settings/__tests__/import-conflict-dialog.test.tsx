// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ImportConflict } from "../import-plan"
import { ImportConflictDialog } from "../import-conflict-dialog"

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function conflict(n: number): ImportConflict {
  return {
    key: `c${n}`,
    path: "Dev Tools",
    incomingTitle: `Incoming ${n}`,
    existingTitle: `Existing ${n}`,
    url: `https://example.com/${n}`,
  }
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

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mount(conflicts: ImportConflict[]) {
  const onResolve = vi.fn()
  const onCancel = vi.fn()
  render(
    <ImportConflictDialog
      conflicts={conflicts}
      onResolve={onResolve}
      onCancel={onCancel}
    />
  )
  return { onResolve, onCancel }
}

describe("ImportConflictDialog", () => {
  it("shows both sides of the conflict and where it is", () => {
    mount([conflict(1)])

    expect(screen.getByText("Incoming 1")).toBeTruthy()
    expect(screen.getByText("Existing 1")).toBeTruthy()
    expect(screen.getByText("https://example.com/1")).toBeTruthy()
    expect(screen.getByText(/in Dev Tools/)).toBeTruthy()
  })

  it("resolves immediately when there is only one conflict", async () => {
    const user = userEvent.setup()
    const { onResolve } = mount([conflict(1)])

    await user.click(screen.getByRole("button", { name: "Replace" }))

    expect(onResolve).toHaveBeenCalledWith({ c1: "replace" })
  })

  it("walks through conflicts one at a time, keeping each answer", async () => {
    const user = userEvent.setup()
    const { onResolve } = mount([conflict(1), conflict(2)])

    expect(screen.getByText(/Conflict 1 of 2/)).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Skip" }))

    expect(screen.getByText(/Conflict 2 of 2/)).toBeTruthy()
    expect(onResolve).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Keep both" }))

    expect(onResolve).toHaveBeenCalledWith({ c1: "skip", c2: "keep-both" })
  })

  it("applies one answer to every remaining conflict when asked to", async () => {
    const user = userEvent.setup()
    const { onResolve } = mount([conflict(1), conflict(2), conflict(3)])

    await user.click(screen.getByRole("button", { name: "Replace" }))
    await user.click(screen.getByRole("checkbox"))
    await user.click(screen.getByRole("button", { name: "Skip" }))

    expect(onResolve).toHaveBeenCalledWith({
      c1: "replace",
      c2: "skip",
      c3: "skip",
    })
  })

  it("cancels without resolving anything", async () => {
    const user = userEvent.setup()
    const { onResolve, onCancel } = mount([conflict(1), conflict(2)])

    await user.click(screen.getByRole("button", { name: "Cancel import" }))

    expect(onCancel).toHaveBeenCalled()
    expect(onResolve).not.toHaveBeenCalled()
  })
})
