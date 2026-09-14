// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { ThemeProvider } from "@/components/theme-provider"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useSourceStore } from "@/stores/source-store"
import { emptySourceConfig } from "@/sources/config"
import { OnboardingWizard } from "../onboarding-wizard"
import { getOnboardingCompleted } from "@/browser/onboarding-preference"
import {
  setPlatformCapabilities,
  type PlatformCapabilities,
} from "@/sources/platform"
import type { AdapterCapabilities, BrowserAdapter } from "@/browser"

/** Safari: an extension with daemon connections and no Browser Source. */
const SAFARI_CAPABILITIES = {
  buildTarget: "safari",
  browserSource: false,
  omnibox: false,
  newTabOverride: false,
  isExtension: true,
  daemonSource: true,
} as const

/**
 * A platform with a single source, so the wizard has no question left to ask
 * and the teaching card is the whole of it. Both shapes below differ only in
 * the capabilities each line of that card is gated on.
 */
const CHROME_ONLY_CAPABILITIES: PlatformCapabilities = {
  buildTarget: "chrome",
  browserSource: true,
  omnibox: true,
  newTabOverride: true,
  isExtension: true,
  daemonSource: false,
}

/** The daemon-served web app: no omnibox, and no new tab page to replace. */
const DAEMON_APP_CAPABILITIES: PlatformCapabilities = {
  buildTarget: "daemon",
  browserSource: false,
  omnibox: false,
  newTabOverride: false,
  isExtension: false,
  daemonSource: true,
}

const BOOKMARK_TREE = [
  {
    id: "0",
    title: "",
    children: [
      { id: "1", title: "Bookmarks Bar", children: [] },
      { id: "2", title: "Other Bookmarks", children: [] },
    ],
  },
]

/** An adapter shaped like the bookmark store's, with the ordering capabilities under test. */
function adapterWith(
  capabilities: AdapterCapabilities,
  options: { setChildOrder?: boolean } = {}
): BrowserAdapter {
  return {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([]),
      getSubTree: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      ...(options.setChildOrder ? { setChildOrder: vi.fn() } : {}),
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
    capabilities,
  } as unknown as BrowserAdapter
}

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

installFakeIndexedDB()

/** Restored before each test, since some replace it with a spy. */
const originalSetSourceEnabled = useSourceStore.getState().setSourceEnabled

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
  // A desktop extension context: the source step offers the Browser Source.
  vi.stubGlobal("chrome", { bookmarks: {}, storage: {} })
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
    adapter: undefined,
    tree: BOOKMARK_TREE,
    rootFolderId: null,
    mutationError: null,
    setRootFolderId: vi.fn(),
    createFolder: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
  })

  useSourceStore.setState({
    config: emptySourceConfig(),
    setSourceEnabled: originalSetSourceEnabled,
  })
})

afterEach(() => {
  cleanup()
  setPlatformCapabilities(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  installFakeIndexedDB()
})

/** Presses the primary button until the teaching card is on screen. */
async function advanceToTips(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 5; i++) {
    if (screen.queryByRole("heading", { name: "You're all set" })) return
    await user.click(
      screen.getByRole("button", { name: /^(Next|Skip for now)$/ })
    )
  }
}

describe("OnboardingWizard step track", () => {
  it("opens on the first real question rather than a welcome screen", () => {
    renderWizard()

    expect(screen.getByRole("heading", { name: "Your bookmarks" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Get Started" })).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "Bookmarks — But Better" })
    ).toBeNull()
  })

  it("is a dialog that says where the user is on the track", () => {
    renderWizard()

    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByText("Step 1 of 3")).toBeTruthy()
  })

  it("never asks about appearance — Settings owns it", () => {
    renderWizard()

    expect(screen.queryByText("Make it yours")).toBeNull()
    expect(screen.queryByRole("button", { name: "Bubblegum" })).toBeNull()
  })

  it("is the teaching card alone where the platform has nothing to ask", () => {
    // The daemon-served build with nothing to point at yet. There is no step
    // to skip past, so the finish button is the only way out — the invariant
    // the e2e suites' `completeOnboarding` helpers lean on.
    setPlatformCapabilities(DAEMON_APP_CAPABILITIES)
    useBookmarkStore.setState({ tree: [] })
    renderWizard()

    expect(screen.getByRole("heading", { name: "You're all set" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Skip setup" })).toBeNull()
    expect(screen.getByRole("button", { name: "Open dashboard" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
    expect(screen.queryByText(/Step \d of/)).toBeNull()
  })

  it("offers skipping from the very first step", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("button", { name: "Skip setup" }))

    await waitFor(async () => {
      expect(await getOnboardingCompleted()).toBe(true)
    })
  })
})

describe("OnboardingWizard source step", () => {
  it("offers Browser bookmarks and a local vault as two switches, browser on by default", () => {
    renderWizard()

    expect(
      screen
        .getByRole("switch", { name: "Browser bookmarks" })
        .getAttribute("aria-checked")
    ).toBe("true")
    expect(
      screen
        .getByRole("switch", { name: "Local vault" })
        .getAttribute("aria-checked")
    ).toBe("false")
    expect(screen.queryByText("Included")).toBeNull()
  })

  it("keeps at least one on: switching Browser bookmarks off switches the vault on", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("switch", { name: "Browser bookmarks" }))

    expect(
      screen
        .getByRole("switch", { name: "Local vault" })
        .getAttribute("aria-checked")
    ).toBe("true")
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(
      screen.getByRole("heading", { name: "Connect your vault" })
    ).toBeTruthy()
    expect(
      screen.getByText(/keep Browser bookmarks until a vault is connected/)
    ).toBeTruthy()
  })

  it("switches Browser bookmarks off on finish once a vault is connected", async () => {
    const user = userEvent.setup()
    const setSourceEnabled = vi.fn().mockResolvedValue(true)
    useSourceStore.setState({ setSourceEnabled })
    renderWizard()

    await user.click(screen.getByRole("switch", { name: "Browser bookmarks" }))
    await user.click(screen.getByRole("button", { name: "Next" }))
    act(() => {
      useSourceStore.setState({
        config: {
          ...emptySourceConfig(),
          connections: { "http://127.0.0.1:52222": {} },
        },
      })
    })
    await user.click(screen.getByRole("button", { name: "Skip setup" }))

    await waitFor(() => {
      expect(setSourceEnabled).toHaveBeenCalledWith("browser", false)
    })
  })

  it("leaves Browser bookmarks on when no vault was connected to replace it", async () => {
    const user = userEvent.setup()
    const setSourceEnabled = vi.fn().mockResolvedValue(true)
    useSourceStore.setState({ setSourceEnabled })
    renderWizard()

    await user.click(screen.getByRole("switch", { name: "Browser bookmarks" }))
    await user.click(screen.getByRole("button", { name: "Skip setup" }))

    await waitFor(async () => {
      expect(await getOnboardingCompleted()).toBe(true)
    })
    expect(setSourceEnabled).not.toHaveBeenCalled()
  })

  it("adds the vault step only when adding a vault is turned on", async () => {
    const user = userEvent.setup()
    renderWizard()

    expect(screen.queryByText("Connect your vault")).toBeNull()

    await user.click(screen.getByRole("switch", { name: "Local vault" }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(
      screen.getByRole("heading", { name: "Connect your vault" })
    ).toBeTruthy()
  })

  it("goes straight to the root folder step without a vault", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("Choose your bookmark folder")).toBeTruthy()
  })

  it("never offers the Standalone source to a new profile, in any spelling", () => {
    renderWizard()

    expect(screen.getByRole("heading", { name: "Your bookmarks" })).toBeTruthy()

    // The sunset removed it from new-user UI entirely.
    expect(screen.queryByText(/standalone/i)).toBeNull()
  })

  it("on a daemon-only platform there is no source step, and the vault step is on the track", () => {
    // Safari's capabilities: no Browser Source, so a daemon Vault is the only
    // way in and there is nothing to add it to.
    setPlatformCapabilities(SAFARI_CAPABILITIES)
    renderWizard()

    expect(screen.queryByRole("heading", { name: "Your bookmarks" })).toBeNull()
    expect(
      screen.getByRole("heading", { name: "Connect your vault" })
    ).toBeTruthy()
  })

  it("on a daemon-only platform, the vault step says the browser's own bookmarks are not used", () => {
    setPlatformCapabilities(SAFARI_CAPABILITIES)
    renderWizard()

    expect(
      screen.getByText(/does not share its own bookmarks with extensions/)
    ).toBeTruthy()
    expect(screen.getByText(/iCloud Drive/)).toBeTruthy()
  })

  it("skips the source step where a daemon cannot be reached at all", () => {
    // Firefox for Android: a Browser Source and nothing else, so there is no
    // vault to add.
    setPlatformCapabilities({
      buildTarget: "firefox",
      browserSource: true,
      omnibox: true,
      newTabOverride: true,
      isExtension: true,
      daemonSource: false,
    })
    renderWizard()

    expect(screen.queryByRole("heading", { name: "Your bookmarks" })).toBeNull()
    expect(screen.getByText("Choose your bookmark folder")).toBeTruthy()
  })

  it("completing with a vault asked for but not connected still marks onboarding done", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("switch", { name: "Local vault" }))
    await user.click(screen.getByRole("button", { name: "Skip setup" }))

    await waitFor(async () => {
      expect(await getOnboardingCompleted()).toBe(true)
    })
  })
})

describe("OnboardingWizard vault step", () => {
  it("shows the Daemon Manager command and says skipping keeps Browser bookmarks", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("switch", { name: "Local vault" }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("npx bookmarks-but-better@latest")).toBeTruthy()
    expect(screen.getByText(/start on Browser bookmarks/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy()
  })

  it("confirms a connection and moves on with Next instead of Skip for now", async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole("switch", { name: "Local vault" }))
    await user.click(screen.getByRole("button", { name: "Next" }))

    act(() => {
      useSourceStore.setState({
        config: {
          ...emptySourceConfig(),
          connections: { "http://127.0.0.1:52222": {} },
        },
      })
    })

    expect(screen.getByRole("status").textContent).toContain("Connected")
    expect(screen.queryByLabelText("Daemon address")).toBeNull()
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull()
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

  it("drops the step entirely when the tree offers nowhere to point", async () => {
    // No folder to select and no parent to create one under: the picker's only
    // entry would be "all bookmarks", which is what choosing nothing means.
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: [] })

    renderWizard()

    expect(screen.queryByText("Choose your bookmark folder")).toBeNull()
    expect(screen.queryByLabelText("New folder name")).toBeNull()
    // The source step is followed straight by the teaching card.
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByRole("heading", { name: "You're all set" })).toBeTruthy()
  })

  it("keeps the step when an empty tree root is itself creatable", async () => {
    // A freshly connected, empty daemon Vault: no folders yet, but its root
    // accepts one, so "create a folder to point at" is a real choice.
    const user = userEvent.setup()
    useBookmarkStore.setState({
      tree: [{ id: "root", title: "reading", children: [] }],
      adapter: adapterWith({
        openInManager: false,
        move: true,
        reorder: false,
        setChildOrder: true,
        rootIsCreatable: true,
      }),
    })

    renderWizard()
    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByText("Choose your bookmark folder")).toBeTruthy()
  })

  it("starts on the Bookmarks Bar rather than Browser Root", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: BOOKMARK_TREE, rootFolderId: null })

    renderWizard()

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByRole("combobox").textContent).toBe("Bookmarks Bar")
  })

  it("keeps an already-saved root folder when the wizard is re-opened", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: BOOKMARK_TREE, rootFolderId: "2" })

    renderWizard()

    await user.click(screen.getByRole("button", { name: "Next" }))

    expect(screen.getByRole("combobox").textContent).toBe("Other Bookmarks")
  })

  it("never writes a browser folder into a vault connected mid-wizard", async () => {
    const user = userEvent.setup()
    const setRootFolderId = vi.fn()
    useBookmarkStore.setState({ tree: BOOKMARK_TREE, setRootFolderId })

    renderWizard()

    // Connecting a vault switches the Active Source: a new adapter and a tree
    // in which the browser's Bookmarks Bar ("1") does not exist.
    act(() => {
      useBookmarkStore.setState({
        adapter: adapterWith({
          openInManager: false,
          move: true,
          reorder: false,
          setChildOrder: true,
          rootIsCreatable: true,
        }),
        tree: [
          {
            id: "vault-root",
            title: "reading",
            children: [{ id: "inbox", title: "Inbox", children: [] }],
          },
        ],
      })
    })

    await user.click(screen.getByRole("button", { name: "Skip setup" }))

    await waitFor(async () => {
      expect(await getOnboardingCompleted()).toBe(true)
    })
    expect(setRootFolderId).not.toHaveBeenCalledWith("1")
  })
})

/**
 * The card's hard constraint (ADR 0004): every line is driven by a Platform
 * Capability or an adapter capability, never by a build target or a browser
 * name. Only the current step is rendered, so where the card is not the only
 * step the tests walk to it before asserting an absence.
 */
describe("OnboardingWizard teaching card", () => {
  it("teaches type-to-search on every platform", () => {
    setPlatformCapabilities(DAEMON_APP_CAPABILITIES)
    useBookmarkStore.setState({ tree: [] })
    renderWizard()

    expect(screen.getByRole("heading", { name: "You're all set" })).toBeTruthy()
    expect(
      screen.getByText(/first character you type opens search/)
    ).toBeTruthy()
    expect(screen.getByText(/Move between bookmarks and folders/)).toBeTruthy()
  })

  it("names the bb keyword where an omnibox exists", () => {
    setPlatformCapabilities(CHROME_ONLY_CAPABILITIES)
    useBookmarkStore.setState({ tree: [] })
    renderWizard()

    // The same matchers the "no omnibox" case asserts the absence of, so an
    // absence there means the line is gone rather than the matcher being wrong.
    expect(screen.getByText("bb")).toBeTruthy()
    expect(screen.getByText(/\bbb\b/)).toBeTruthy()
    expect(screen.getByText(/address bar/)).toBeTruthy()
  })

  it("never names bb where there is no omnibox", () => {
    setPlatformCapabilities(DAEMON_APP_CAPABILITIES)
    useBookmarkStore.setState({ tree: [] })
    renderWizard()

    expect(screen.queryByText(/\bbb\b/)).toBeNull()
    expect(screen.queryByText(/address bar/)).toBeNull()
  })

  it("promises a new tab where this build replaces one", () => {
    setPlatformCapabilities(CHROME_ONLY_CAPABILITIES)
    useBookmarkStore.setState({ tree: [] })
    renderWizard()

    expect(screen.getByText(/Every new tab is this dashboard/)).toBeTruthy()
    expect(screen.getByText(/new tab/i)).toBeTruthy()
  })

  it("never promises a new tab where this build replaces none", () => {
    setPlatformCapabilities(DAEMON_APP_CAPABILITIES)
    useBookmarkStore.setState({ tree: [] })
    renderWizard()

    expect(screen.queryByText(/new tab/i)).toBeNull()
  })

  it("also refuses the new-tab promise on Safari, where the wizard has other steps", async () => {
    const user = userEvent.setup()
    setPlatformCapabilities(SAFARI_CAPABILITIES)
    useBookmarkStore.setState({ tree: [] })
    renderWizard()

    await advanceToTips(user)

    expect(screen.getByRole("heading", { name: "You're all set" })).toBeTruthy()
    expect(screen.queryByText(/new tab/i)).toBeNull()
    expect(screen.queryByText(/\bbb\b/)).toBeNull()
  })

  it("teaches Alt+arrow where the source reorders through move()", () => {
    setPlatformCapabilities(CHROME_ONLY_CAPABILITIES)
    useBookmarkStore.setState({
      tree: [],
      adapter: adapterWith({
        openInManager: false,
        move: true,
        reorder: true,
        setChildOrder: false,
      }),
    })
    renderWizard()

    expect(screen.getByText("Alt")).toBeTruthy()
  })

  it("teaches Alt+arrow where the source reorders through setChildOrder()", () => {
    setPlatformCapabilities(CHROME_ONLY_CAPABILITIES)
    useBookmarkStore.setState({
      tree: [],
      adapter: adapterWith(
        {
          openInManager: false,
          move: true,
          reorder: false,
          setChildOrder: true,
        },
        { setChildOrder: true }
      ),
    })
    renderWizard()

    expect(screen.getByText("Alt")).toBeTruthy()
  })

  it("never teaches Alt+arrow where neither ordering capability is there", () => {
    setPlatformCapabilities(CHROME_ONLY_CAPABILITIES)
    useBookmarkStore.setState({
      tree: [],
      adapter: adapterWith({
        openInManager: false,
        move: true,
        reorder: false,
        setChildOrder: false,
      }),
    })
    renderWizard()

    expect(screen.queryByText("Alt")).toBeNull()
    // The arrow keys themselves still navigate, so that half stays.
    expect(screen.getByText(/Move between bookmarks and folders/)).toBeTruthy()
  })

  it("never teaches Alt+arrow when the capability flag has no method behind it", () => {
    setPlatformCapabilities(CHROME_ONLY_CAPABILITIES)
    useBookmarkStore.setState({
      tree: [],
      adapter: adapterWith({
        openInManager: false,
        move: true,
        reorder: false,
        setChildOrder: true,
      }),
    })
    renderWizard()

    expect(screen.queryByText("Alt")).toBeNull()
  })

  it("never teaches Alt+arrow before any source is connected", async () => {
    const user = userEvent.setup()
    setPlatformCapabilities(SAFARI_CAPABILITIES)
    useBookmarkStore.setState({ tree: [], adapter: undefined })
    renderWizard()

    await advanceToTips(user)

    expect(screen.getByRole("heading", { name: "You're all set" })).toBeTruthy()
    expect(screen.queryByText("Alt")).toBeNull()
  })
})
