// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { ThemeProvider } from "@/components/theme-provider"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { OnboardingWizard } from "../onboarding-wizard"

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

installFakeIndexedDB()

function renderWizard(onComplete = vi.fn()) {
  return {
    onComplete,
    ...render(
      <ThemeProvider>
        <OnboardingWizard onComplete={onComplete} />
      </ThemeProvider>
    ),
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

  usePreferencesStore.setState({
    adapterMode: "browser",
    setAdapterMode: vi.fn(),
    adapter: {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([]),
        getSubTree: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        removeTree: vi.fn(),
        move: vi.fn(),
        onChanged: vi.fn(() => () => {}),
        onCreated: vi.fn(() => () => {}),
        onRemoved: vi.fn(() => () => {}),
        onMoved: vi.fn(() => () => {}),
        openInManager: vi.fn(),
      },
      storage: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      favicon: { getUrl: vi.fn(), isAvailable: vi.fn(() => false) },
      capabilities: {
        openInManager: false,
        move: true,
        reorder: true,
        setChildOrder: false,
      },
    },
  })

  useBookmarkStore.setState({
    tree: [],
    rootFolderId: null,
    mutationError: null,
    setRootFolderId: vi.fn(),
    createFolder: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  installFakeIndexedDB()
})

describe("OnboardingWizard mode step", () => {
  it("adds a daemon setup step only when Daemon is selected", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    expect(screen.getByText("Where do your bookmarks live?")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: /Daemon/ }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("Set up the daemon")).toBeTruthy()
  })

  it("skips straight to the root folder step for Browser", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    await user.click(screen.getByRole("button", { name: /Browser/ }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("Choose your bookmark folder")).toBeTruthy()
  })

  it("skips straight to the root folder step for Standalone", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    await user.click(
      screen.getByRole("button", {
        name: "Advanced: use a standalone collection stored in this browser only",
      })
    )
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("Choose your bookmark folder")).toBeTruthy()
  })

  it("does not persist adapterMode when the wizard completes with Daemon selected but not connected", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    await user.click(screen.getByRole("button", { name: /Daemon/ }))
    await user.click(screen.getByRole("button", { name: "Skip, use defaults" }))

    await waitFor(() => {
      expect(
        usePreferencesStore.getState().setAdapterMode
      ).not.toHaveBeenCalled()
    })
  })

  it("persists adapterMode for Browser on completion", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    await user.click(screen.getByRole("button", { name: /Browser/ }))
    await user.click(screen.getByRole("button", { name: "Skip, use defaults" }))

    await waitFor(() => {
      expect(
        usePreferencesStore.getState().setAdapterMode
      ).toHaveBeenCalledWith("browser")
    })
  })
})

describe("OnboardingWizard root folder step", () => {
  it("creates a folder and selects it as the root", async () => {
    const user = userEvent.setup()
    const createFolder = vi.fn().mockResolvedValue({ id: "new-folder" })
    useBookmarkStore.setState({
      tree: [
        {
          id: "0",
          title: "",
          children: [{ id: "1", title: "Bookmarks Bar", children: [] }],
        },
      ],
      createFolder,
    })

    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    await user.click(screen.getByRole("button", { name: /Browser/ }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("Choose your bookmark folder")).toBeTruthy()

    await user.type(
      screen.getByLabelText("New folder name"),
      "Personal Bookmarks"
    )
    await user.click(screen.getByRole("button", { name: "Create folder" }))

    await waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith("1", "Personal Bookmarks")
    })
  })

  it("hides the create-folder control when there is no valid parent", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: [] })

    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    await user.click(screen.getByRole("button", { name: /Browser/ }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.queryByLabelText("New folder name")).toBeNull()
  })

  it("starts on the Bookmarks Bar rather than Browser Root", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({
      tree: [
        {
          id: "0",
          title: "",
          children: [
            { id: "1", title: "Bookmarks Bar", children: [] },
            { id: "2", title: "Other Bookmarks", children: [] },
          ],
        },
      ],
      rootFolderId: null,
    })

    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    await user.click(screen.getByRole("button", { name: /Browser/ }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByRole("combobox").textContent).toBe("Bookmarks Bar")
  })

  it("keeps an already-saved root folder when the wizard is re-opened", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({
      tree: [
        {
          id: "0",
          title: "",
          children: [
            { id: "1", title: "Bookmarks Bar", children: [] },
            { id: "2", title: "Other Bookmarks", children: [] },
          ],
        },
      ],
      rootFolderId: "2",
    })

    renderWizard()

    await user.click(screen.getByRole("button", { name: "Get Started" }))
    await user.click(screen.getByRole("button", { name: /Browser/ }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByRole("combobox").textContent).toBe("Other Bookmarks")
  })
})
