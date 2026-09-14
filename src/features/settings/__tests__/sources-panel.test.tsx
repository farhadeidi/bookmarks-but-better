// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { useSourceStore } from "@/stores/source-store"
import { daemonSourceId } from "@/sources/config"
import { SourcesPanel } from "../panels/sources-panel"

installFakeIndexedDB()

const ORIGIN = "http://127.0.0.1:52224"
const VAULT_ID = daemonSourceId(ORIGIN, "main")

/** Stands in for discovery, so opening the panel never touches the network. */
const refreshDaemonVaults = vi.fn<(origin?: string) => Promise<string[]>>()

beforeEach(() => {
  installFakeIndexedDB()
  vi.stubGlobal("chrome", { bookmarks: {}, storage: {} })
  refreshDaemonVaults.mockReset()
  refreshDaemonVaults.mockResolvedValue([ORIGIN])
  useSourceStore.setState({
    refreshDaemonVaults,
    status: "ready",
    switching: false,
    lastSwitchError: null,
    activeSourceId: "browser",
    config: {
      version: 2,
      connections: { [ORIGIN]: {} },
      sources: {
        browser: { enabled: true },
        standalone: { enabled: true, legacy: true },
        [VAULT_ID]: { enabled: true, origin: ORIGIN, vaultId: "main" },
      },
      activeSourceId: "browser",
    },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The switch for one source, asserting its checked state on the way. */
function switchOf(label: string, checked: boolean) {
  return screen.getByRole("switch", { name: label, checked })
}

describe("SourcesPanel enable switches", () => {
  it("show every source's enabled state from the store subscription", () => {
    render(<SourcesPanel onMigrateStandalone={() => {}} />)

    expect(switchOf("Enable Browser bookmarks", true)).toBeTruthy()
    expect(switchOf("Enable Standalone (legacy)", true)).toBeTruthy()
    expect(switchOf("Enable main · 127.0.0.1:52224", true)).toBeTruthy()
  })

  it("track enable/disable reactively in both sections, not just daemon sources", async () => {
    render(<SourcesPanel onMigrateStandalone={() => {}} />)

    // Neither is the Active Source, so no session transition is involved:
    // the switches must follow the config the panel is subscribed to.
    await useSourceStore.getState().setSourceEnabled("standalone", false)
    await useSourceStore.getState().setSourceEnabled(VAULT_ID, false)

    await waitFor(() => {
      expect(switchOf("Enable Standalone (legacy)", false)).toBeTruthy()
    })
    expect(switchOf("Enable main · 127.0.0.1:52224", false)).toBeTruthy()
    expect(switchOf("Enable Browser bookmarks", true)).toBeTruthy()
  })
})

describe("SourcesPanel source management", () => {
  it("groups Vaults under their daemon and keeps refresh and forget in its actions menu", async () => {
    const user = userEvent.setup()
    render(<SourcesPanel onMigrateStandalone={() => {}} />)

    const daemon = screen.getByRole("group", { name: `Daemon ${ORIGIN}` })
    expect(within(daemon).getByText(/1 Vault/)).toBeTruthy()
    expect(
      within(daemon).getByText(/npx bookmarks-but-better@latest vault/)
    ).toBeTruthy()

    await user.click(
      within(daemon).getByRole("button", {
        name: `Actions for daemon ${ORIGIN}`,
      })
    )
    expect(
      await screen.findByRole("menuitem", { name: "Refresh Vaults" })
    ).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Forget daemon" })).toBeTruthy()
  })

  it("says whether each daemon answered when Sources opens", async () => {
    render(<SourcesPanel onMigrateStandalone={() => {}} />)

    const daemon = screen.getByRole("group", { name: `Daemon ${ORIGIN}` })
    expect(await within(daemon).findByText(/Connected · 1 Vault/)).toBeTruthy()
    expect(within(daemon).queryByRole("button", { name: "Retry" })).toBeNull()
  })

  it("checks daemons that only arrive once sources have loaded, instead of calling them unreachable", async () => {
    // The standalone Settings page renders Sources before the store is ready.
    const loaded = useSourceStore.getState().config
    useSourceStore.setState({
      status: "loading",
      config: {
        version: 2,
        connections: {},
        sources: {},
        activeSourceId: null,
      },
    })
    render(<SourcesPanel onMigrateStandalone={() => {}} />)
    expect(refreshDaemonVaults).not.toHaveBeenCalled()

    act(() => {
      useSourceStore.setState({ status: "ready", config: loaded })
    })

    const daemon = await screen.findByRole("group", {
      name: `Daemon ${ORIGIN}`,
    })
    expect(await within(daemon).findByText(/Connected · 1 Vault/)).toBeTruthy()
    expect(within(daemon).queryByText(/Unreachable/)).toBeNull()
  })

  it("marks a daemon that does not answer as unreachable and offers Retry", async () => {
    refreshDaemonVaults.mockResolvedValue([])
    render(<SourcesPanel onMigrateStandalone={() => {}} />)

    const daemon = screen.getByRole("group", { name: `Daemon ${ORIGIN}` })
    expect(
      await within(daemon).findByText(/Unreachable · 1 Vault/)
    ).toBeTruthy()

    refreshDaemonVaults.mockResolvedValue([ORIGIN])
    fireEvent.click(within(daemon).getByRole("button", { name: "Retry" }))
    expect(await within(daemon).findByText(/Connected · 1 Vault/)).toBeTruthy()
    expect(refreshDaemonVaults).toHaveBeenLastCalledWith(ORIGIN)
  })

  it("renames a source only for this profile", async () => {
    render(<SourcesPanel onMigrateStandalone={() => {}} />)

    fireEvent.click(
      screen.getByRole("button", {
        name: "Rename main · 127.0.0.1:52224",
      })
    )
    fireEvent.change(screen.getByRole("textbox", { name: "Display label" }), {
      target: { value: "Research" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save label" }))

    await waitFor(() => {
      expect(screen.getByText("Research")).toBeTruthy()
    })
    expect(useSourceStore.getState().config.sources[VAULT_ID]?.label).toBe(
      "Research"
    )
  })
})
