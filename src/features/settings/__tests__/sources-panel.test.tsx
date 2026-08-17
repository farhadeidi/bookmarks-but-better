// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { useSourceStore } from "@/stores/source-store"
import { daemonSourceId } from "@/sources/config"
import { SourcesPanel } from "../panels/sources-panel"

installFakeIndexedDB()

const ORIGIN = "http://127.0.0.1:52224"
const VAULT_ID = daemonSourceId(ORIGIN, "main")

beforeEach(() => {
  installFakeIndexedDB()
  vi.stubGlobal("chrome", { bookmarks: {}, storage: {} })
  useSourceStore.setState({
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
  it("groups Vaults under their daemon and exposes refresh and forget actions", () => {
    render(<SourcesPanel onMigrateStandalone={() => {}} />)

    const daemon = screen.getByRole("group", { name: `Daemon ${ORIGIN}` })
    expect(within(daemon).getByText("1 Vault")).toBeTruthy()
    expect(
      within(daemon).getByRole("button", { name: "Refresh Vaults" })
    ).toBeTruthy()
    expect(
      within(daemon).getByRole("button", { name: "Forget daemon" })
    ).toBeTruthy()
    expect(
      within(daemon).getByText(/Add, remove, or rename Vaults/)
    ).toBeTruthy()
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
