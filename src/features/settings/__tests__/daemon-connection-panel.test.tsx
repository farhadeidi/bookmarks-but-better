// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { useSourceStore } from "@/stores/source-store"
import { emptySourceConfig } from "@/sources/config"
import { DaemonConnectionPanel } from "../daemon-connection-panel"

const connectToDaemon = vi.fn()

vi.mock("@/browser/daemon", async () => {
  const actual =
    await vi.importActual<typeof import("@/browser/daemon")>("@/browser/daemon")
  return {
    ...actual,
    connectToDaemon: (...args: unknown[]) => connectToDaemon(...args),
  }
})

installFakeIndexedDB()

function seedConfig(connections: Record<string, { bearerToken?: string }>) {
  useSourceStore.setState({
    status: "ready",
    switching: false,
    lastSwitchError: null,
    config: { ...emptySourceConfig(), connections },
    activeSourceId: "browser",
  })
}

beforeEach(() => {
  seedConfig({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  installFakeIndexedDB()
})

describe("DaemonConnectionPanel", () => {
  it("shows a Connect button and an address field when nothing is connected", () => {
    render(<DaemonConnectionPanel />)

    expect(screen.getByLabelText("Daemon address")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy()
    expect(screen.queryByText("Connected daemons")).toBeNull()
  })

  it("attempts a connection with the typed address and records it on success, with no reload", async () => {
    connectToDaemon.mockResolvedValue({
      ok: true,
      origin: "http://127.0.0.1:47321",
      warnings: [],
      vaults: [{ id: "main" }],
    })
    render(<DaemonConnectionPanel />)

    const input = screen.getByLabelText("Daemon address")
    fireEvent.change(input, { target: { value: "127.0.0.1:47321" } })
    fireEvent.click(screen.getByRole("button", { name: "Connect" }))

    await waitFor(() => expect(connectToDaemon).toHaveBeenCalledTimes(1))
    expect(connectToDaemon.mock.calls[0][0]).toBe("127.0.0.1:47321")
    // Live switching replaced the reload: the panel settles back to idle.
    await waitFor(() => {
      expect(screen.getByText("http://127.0.0.1:47321")).toBeTruthy()
    })
  })

  it("shows the failure message and offers Retry without recording anything", async () => {
    connectToDaemon.mockResolvedValue({
      ok: false,
      stage: "health",
      message: "Could not reach http://127.0.0.1:52222.",
    })
    render(<DaemonConnectionPanel />)

    fireEvent.click(screen.getByRole("button", { name: "Connect" }))

    await waitFor(() => {
      expect(
        screen.getByText("Could not reach http://127.0.0.1:52222.")
      ).toBeTruthy()
    })
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy()
    expect(useSourceStore.getState().config.connections).toEqual({})
  })

  it("lists a stored connection with its own Forget action", () => {
    seedConfig({ "http://127.0.0.1:47321": {} })
    render(<DaemonConnectionPanel />)

    expect(screen.getByText("http://127.0.0.1:47321")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Forget" })).toBeTruthy()
  })

  it("forgets through the source store, which owns persistence", async () => {
    seedConfig({ "http://127.0.0.1:47321": {} })
    const forgetDaemon = vi.fn().mockResolvedValue(undefined)
    useSourceStore.setState({ forgetDaemon })

    render(<DaemonConnectionPanel />)
    fireEvent.click(screen.getByRole("button", { name: "Forget" }))

    await waitFor(() =>
      expect(forgetDaemon).toHaveBeenCalledWith("http://127.0.0.1:47321")
    )
  })

  it("reveals the bearer-token field and install guide under Advanced", () => {
    render(<DaemonConnectionPanel />)

    expect(screen.queryByLabelText("Daemon bearer token")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }))
    expect(screen.getByLabelText("Daemon bearer token")).toBeTruthy()
    expect(screen.getByText(/bookmarks-but-better setup/)).toBeTruthy()
  })

  /**
   * The daemon ships only as a prerelease, and the install command shown here
   * has no flag saying so — it relies on the scripts' fallback. Someone
   * copying it is entitled to know they are getting beta software.
   */
  it("says the install guide gets a prerelease, since no stable release ships the daemon", () => {
    render(<DaemonConnectionPanel />)
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }))

    expect(screen.getByText(/still in beta/)).toBeTruthy()
  })
})
