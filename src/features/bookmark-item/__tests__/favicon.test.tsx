// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Favicon } from "../favicon"

afterEach(cleanup)

/**
 * The empty-source contract: Chromium fires neither `load` nor `error` for
 * `<img src="">`, so an empty primary favicon URL can never reach the
 * error-driven letter fallback on its own — it must start there.
 */

describe("Favicon empty primary source", () => {
  it("renders the letter avatar immediately for an empty primarySrc, with no img element", () => {
    const { container } = render(
      <Favicon url="https://example.com/page" primarySrc="" title="Example" />
    )

    const letter = screen.getByText("E")
    expect(letter.getAttribute("aria-label")).toBe("Example")
    expect(container.querySelector("img")).toBeNull()
  })

  it("skips straight to the letter for an empty primarySrc even when a fallback URL exists", () => {
    const { container } = render(
      <Favicon
        url="https://example.com"
        primarySrc=""
        fallbackSrc="https://fallback.example/icon.png"
        title="Example"
      />
    )

    expect(screen.getByText("E")).toBeTruthy()
    expect(container.querySelector("img")).toBeNull()
  })

  it("falls back to '?' when the URL cannot be parsed", () => {
    render(<Favicon url="not a url" primarySrc="" title="Broken" />)
    expect(screen.getByText("?")).toBeTruthy()
  })
})

describe("Favicon primary source transitions", () => {
  it("loads a real primary once one arrives, and returns to the letter when it empties again", () => {
    const { rerender } = render(
      <Favicon url="https://example.com" primarySrc="" title="Example" />
    )
    expect(screen.getByText("E")).toBeTruthy()

    rerender(
      <Favicon
        url="https://example.com"
        primarySrc="https://icons.example/example.png"
        title="Example"
      />
    )
    const img = document.querySelector("img")
    expect(img?.getAttribute("src")).toBe("https://icons.example/example.png")

    rerender(
      <Favicon url="https://example.com" primarySrc="" title="Example" />
    )
    expect(screen.getByText("E")).toBeTruthy()
    expect(document.querySelector("img")).toBeNull()
  })
})

describe("Favicon error-driven fallback (unchanged for non-empty sources)", () => {
  it("lands on the letter when the primary fails to load", () => {
    render(
      <Favicon
        url="https://example.com"
        primarySrc="https://icons.example/broken.png"
        title="Example"
      />
    )
    fireEvent.error(document.querySelector("img")!)
    expect(screen.getByText("E")).toBeTruthy()
  })

  it("lands on the letter when the primary fails and a fallback exists", () => {
    render(
      <Favicon
        url="https://example.com"
        primarySrc="https://icons.example/broken.png"
        fallbackSrc="https://fallback.example/icon.png"
        title="Example"
      />
    )
    fireEvent.error(document.querySelector("img")!)
    expect(screen.getByText("E")).toBeTruthy()
    expect(document.querySelector("img")).toBeNull()
  })
})
