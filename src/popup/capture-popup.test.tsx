// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { BrowserAdapter } from "@/browser/types"
import type { CaptureControllerDependencies } from "./capture-controller"
import { CapturePopup } from "./capture-popup"

afterEach(cleanup)

function popupDependencies(): {
  dependencies: CaptureControllerDependencies
  adapter: BrowserAdapter
} {
  const adapter: BrowserAdapter = {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([
        {
          id: "0",
          title: "",
          children: [{ id: "1", title: "Bookmarks Bar", children: [] }],
        },
      ]),
      getSubTree: vi.fn(),
      create: vi.fn().mockResolvedValue({
        id: "created",
        title: "Example",
        url: "https://example.com/",
      }),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      onChanged: vi.fn(() => vi.fn()),
      onCreated: vi.fn(() => vi.fn()),
      onRemoved: vi.fn(() => vi.fn()),
      onMoved: vi.fn(() => vi.fn()),
      openInManager: vi.fn(),
      dispose: vi.fn(),
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      remove: vi.fn(),
    },
    favicon: { getUrl: vi.fn(), isAvailable: vi.fn(() => false) },
    capabilities: {
      openInManager: false,
      move: true,
      reorder: true,
      setChildOrder: false,
      rootIsCreatable: false,
    },
  }
  return {
    adapter,
    dependencies: {
      getActiveTab: vi.fn().mockResolvedValue({
        title: "Example",
        url: "https://example.com",
      }),
      selectAdapter: vi.fn().mockResolvedValue({
        adapter,
        source: {
          id: "browser",
          kind: "browser",
          label: "Browser bookmarks",
        },
        choices: [],
      }),
      persistActiveSource: vi.fn().mockResolvedValue(true),
    },
  }
}

describe("CapturePopup", () => {
  it("renders accessible fields and a single primary save action", async () => {
    const { dependencies, adapter } = popupDependencies()
    const user = userEvent.setup()
    render(<CapturePopup dependencies={dependencies} />)

    expect(screen.getByRole("status").textContent).toContain(
      "Loading page details"
    )
    expect(
      (await screen.findByRole("heading", { name: "Save this page" }))
        .isConnected
    ).toBe(true)
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
      "Example"
    )
    expect((screen.getByLabelText("Page") as HTMLInputElement).value).toBe(
      "https://example.com/"
    )
    expect(screen.getByLabelText("Folder").textContent).toContain(
      "Bookmarks Bar"
    )

    await user.click(screen.getByRole("button", { name: "Save bookmark" }))
    await waitFor(() =>
      expect(screen.getByText("Bookmark saved").isConnected).toBe(true)
    )
    expect(adapter.bookmarks.create).toHaveBeenCalledOnce()
  })

  it("clearly rejects an unsupported active page", async () => {
    const { dependencies } = popupDependencies()
    vi.mocked(dependencies.getActiveTab).mockResolvedValue({
      title: "Settings",
      url: "about:preferences",
    })
    render(<CapturePopup dependencies={dependencies} />)

    expect((await screen.findByText("Cannot save this page")).isConnected).toBe(
      true
    )
    expect(screen.getByRole("alert").textContent).toContain(
      "regular http or https page"
    )
    expect(dependencies.selectAdapter).not.toHaveBeenCalled()
  })

  /**
   * Where the popup is the only route to the dashboard — a build with no
   * new-tab override — the error state is exactly when that route matters:
   * "no bookmark source is enabled" sends the user to the dashboard to connect
   * one. Rendering the way out only beside the form left a Safari user with a
   * message telling them to go somewhere and no way to get there.
   */
  it("keeps the route to the dashboard when there is nothing to save into", async () => {
    vi.stubEnv("VITE_BUILD_TARGET", "safari")
    vi.stubGlobal("chrome", {
      storage: {},
      runtime: { id: "safari-extension", getURL: (path: string) => path },
      tabs: { create: vi.fn() },
    })

    const { dependencies } = popupDependencies()
    vi.mocked(dependencies.getActiveTab).mockResolvedValue({
      title: "Settings",
      url: "about:preferences",
    })
    render(<CapturePopup dependencies={dependencies} />)

    expect((await screen.findByText("Cannot save this page")).isConnected).toBe(
      true
    )
    expect(
      screen.getByRole("button", { name: "Open the dashboard" }).isConnected
    ).toBe(true)

    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
})
