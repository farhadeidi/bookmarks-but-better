// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { Favicon } from "../favicon"

/**
 * The component's half of the contract, with resolution stubbed out: it walks
 * the sources it is given, and every way of running out of them ends at the
 * letter placeholder rather than a broken image.
 */

const resolve = vi.fn<(pageUrl: string) => Promise<{ sources: string[] }>>()
const reportMiss = vi.fn<(pageUrl: string) => Promise<void>>()

vi.mock("@/browser/favicon/resolve", () => ({
  faviconResolver: {
    resolve: (pageUrl: string) => resolve(pageUrl),
    reportMiss: (pageUrl: string) => reportMiss(pageUrl),
  },
}))

function mount(url: string, title = "Example") {
  useBookmarkStore.setState({
    adapter: {
      bookmarks: {} as never,
      storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      favicon: { getUrl: () => "", isAvailable: () => true },
      capabilities: {
        openInManager: false,
        move: true,
        reorder: true,
        setChildOrder: false,
      },
    },
  })
  return render(<Favicon url={url} title={title} />)
}

beforeEach(() => {
  resolve.mockReset()
  reportMiss.mockReset()
  resolve.mockResolvedValue({ sources: [] })
})

afterEach(() => {
  cleanup()
  useBookmarkStore.setState({ adapter: null })
})

describe("Favicon with no usable source", () => {
  it("renders the letter avatar when resolution finds nothing, with no img", async () => {
    const { container } = mount("https://example.com/page")

    const letter = await screen.findByText("E")
    expect(letter.getAttribute("aria-label")).toBe("Example")
    expect(container.querySelector("img")).toBeNull()
  })

  it("falls back to '?' for an unparsable URL without asking the resolver", () => {
    render(<Favicon url="not a url" title="Broken" />)

    expect(screen.getByText("?")).toBeTruthy()
    expect(resolve).not.toHaveBeenCalled()
  })

  it("never asks the resolver about a non-HTTP page", () => {
    render(<Favicon url="file:///Users/me/notes.html" title="Notes" />)

    expect(resolve).not.toHaveBeenCalled()
    expect(document.querySelector("img")).toBeNull()
  })

  it("shows a letterless placeholder while resolution is pending", () => {
    resolve.mockReturnValue(new Promise(() => {}))
    const { container } = mount("https://example.com")

    expect(screen.queryByText("E")).toBeNull()
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("[aria-label='Example']")).toBeTruthy()
  })
})

describe("Favicon source walk", () => {
  it("renders a cached blob source directly", async () => {
    resolve.mockResolvedValue({ sources: ["blob:cached-icon"] })
    mount("https://example.com")

    const img = await screen.findByRole("presentation")
    expect(img.getAttribute("src")).toBe("blob:cached-icon")
  })

  it("advances to the next source when one fails, then lands on the letter", async () => {
    resolve.mockResolvedValue({
      sources: ["https://icons.example/a.png", "https://icons.example/b.png"],
    })
    mount("https://example.com")

    const first = await screen.findByRole("presentation")
    expect(first.getAttribute("src")).toBe("https://icons.example/a.png")

    fireEvent.error(first)
    const second = await screen.findByRole("presentation")
    expect(second.getAttribute("src")).toBe("https://icons.example/b.png")

    fireEvent.error(second)
    expect(await screen.findByText("E")).toBeTruthy()
    expect(document.querySelector("img")).toBeNull()
  })

  it("reports a miss once every source has failed", async () => {
    resolve.mockResolvedValue({ sources: ["https://icons.example/a.png"] })
    mount("https://example.com/deep/page")

    const img = await screen.findByRole("presentation")
    expect(reportMiss).not.toHaveBeenCalled()

    fireEvent.error(img)
    await screen.findByText("E")
    expect(reportMiss).toHaveBeenCalledWith("https://example.com/deep/page")
  })

  it("does not report a miss when resolution simply had nothing to offer", async () => {
    resolve.mockResolvedValue({ sources: [] })
    mount("https://example.com")

    await screen.findByText("E")
    // The resolver already recorded that itself; the component only reports
    // sources that failed in the browser.
    expect(reportMiss).not.toHaveBeenCalled()
  })
})

describe("Favicon and Google's default globe", () => {
  it("treats a 16x16 Google response as a failure and falls through", async () => {
    const globeUrl =
      "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fexample.com&size=64"
    resolve.mockResolvedValue({ sources: [globeUrl] })
    mount("https://example.com")

    const img = await screen.findByRole("presentation")
    Object.defineProperty(img, "naturalWidth", { value: 16 })
    Object.defineProperty(img, "naturalHeight", { value: 16 })
    fireEvent.load(img)

    expect(await screen.findByText("E")).toBeTruthy()
    expect(reportMiss).toHaveBeenCalledWith("https://example.com")
  })

  it("keeps a Google response that is not the globe", async () => {
    const iconUrl =
      "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fexample.com&size=64"
    resolve.mockResolvedValue({ sources: [iconUrl] })
    mount("https://example.com")

    const img = await screen.findByRole("presentation")
    Object.defineProperty(img, "naturalWidth", { value: 64 })
    Object.defineProperty(img, "naturalHeight", { value: 64 })
    fireEvent.load(img)

    expect(screen.queryByText("E")).toBeNull()
    expect(img.getAttribute("src")).toBe(iconUrl)
  })
})
