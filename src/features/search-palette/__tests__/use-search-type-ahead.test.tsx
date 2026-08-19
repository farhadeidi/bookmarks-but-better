// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useSearchTypeAhead } from "../use-search-type-ahead"
import { useUIStore } from "@/stores/ui-store"

/**
 * The palette has no shortcut, so this listener is the whole keyboard
 * entrance: what it opens on, and — the part that would be felt first if it
 * were wrong — everything it must keep its hands off.
 */
function TypeAheadHost() {
  useSearchTypeAhead()

  return (
    <div>
      <button type="button">Plain button</button>
      <input aria-label="A field" />
      <textarea aria-label="A note" />
      <div contentEditable aria-label="A rich field" />
      <div role="dialog" aria-label="Another dialog">
        <button type="button">Button in a dialog</button>
      </div>
    </div>
  )
}

function seedQuery(): string | null {
  return useUIStore.getState().searchPalette?.seedQuery ?? null
}

describe("useSearchTypeAhead", () => {
  beforeEach(() => {
    useUIStore.setState({ searchPalette: null })
    render(<TypeAheadHost />)
  })

  afterEach(() => {
    cleanup()
    useUIStore.setState({ searchPalette: null })
  })

  it("opens the palette on a printable character, seeded with it", () => {
    fireEvent.keyDown(document.body, { key: "g" })

    expect(seedQuery()).toBe("g")
  })

  it("keeps the character out of the page, so quick-find never starts", () => {
    const notPrevented = fireEvent.keyDown(document.body, { key: "g" })

    expect(notPrevented).toBe(false)
  })

  it("treats Shift as part of typing", () => {
    fireEvent.keyDown(document.body, { key: "G", shiftKey: true })

    expect(seedQuery()).toBe("G")
  })

  it("opens from a focusable element that is not a text field", () => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Plain button" }), {
      key: "b",
    })

    expect(seedQuery()).toBe("b")
  })

  it("leaves typing in an input alone", () => {
    fireEvent.keyDown(screen.getByLabelText("A field"), { key: "g" })

    expect(seedQuery()).toBeNull()
  })

  it("leaves typing in a textarea alone", () => {
    fireEvent.keyDown(screen.getByLabelText("A note"), { key: "g" })

    expect(seedQuery()).toBeNull()
  })

  it("leaves typing in a contenteditable alone", () => {
    fireEvent.keyDown(screen.getByLabelText("A rich field"), { key: "g" })

    expect(seedQuery()).toBeNull()
  })

  it("leaves a character typed inside another dialog to that dialog", () => {
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Button in a dialog" }),
      { key: "g" }
    )

    expect(seedQuery()).toBeNull()
  })

  it("ignores a character carrying Ctrl or Command, which belongs to a shortcut", () => {
    fireEvent.keyDown(document.body, { key: "k", metaKey: true })
    expect(seedQuery()).toBeNull()

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true })
    expect(seedQuery()).toBeNull()

    fireEvent.keyDown(document.body, { key: "k", altKey: true })
    expect(seedQuery()).toBeNull()
  })

  it("ignores keys that are not a typed character", () => {
    for (const key of ["Enter", "Tab", "ArrowDown", "Escape", "F5", " "]) {
      fireEvent.keyDown(document.body, { key })
      expect(seedQuery()).toBeNull()
    }
  })

  it("ignores a keystroke another handler already claimed", () => {
    const event = new KeyboardEvent("keydown", {
      key: "g",
      bubbles: true,
      cancelable: true,
    })
    event.preventDefault()
    document.body.dispatchEvent(event)

    expect(seedQuery()).toBeNull()
  })

  it("stops listening once the dashboard unmounts", () => {
    cleanup()

    fireEvent.keyDown(document.body, { key: "g" })

    expect(seedQuery()).toBeNull()
  })
})
