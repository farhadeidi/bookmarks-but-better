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
import { usePreferencesStore } from "@/stores/preferences-store"
import { setDaemonConnectionConfig } from "@/browser/adapter-preference"
import { DaemonConnectionPanel } from "../daemon-connection-panel"

const connectToDaemon = vi.fn()
const disconnectDaemon = vi.fn()
const forgetDaemon = vi.fn()

vi.mock("@/browser/daemon", async () => {
  const actual =
    await vi.importActual<typeof import("@/browser/daemon")>("@/browser/daemon")
  return {
    ...actual,
    connectToDaemon: (...args: unknown[]) => connectToDaemon(...args),
    disconnectDaemon: (...args: unknown[]) => disconnectDaemon(...args),
    forgetDaemon: (...args: unknown[]) => forgetDaemon(...args),
  }
})

installFakeIndexedDB()

const reload = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  usePreferencesStore.setState({ adapterMode: "browser" })
  installFakeIndexedDB()
})

describe("DaemonConnectionPanel", () => {
  it("shows a Connect button and an address field when not connected", () => {
    render(<DaemonConnectionPanel />)

    expect(screen.getByLabelText("Daemon address")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy()
  })

  it("attempts a connection with the typed address and reloads on success", async () => {
    connectToDaemon.mockResolvedValue({
      ok: true,
      origin: "http://127.0.0.1:52222",
      warnings: [],
    })
    render(<DaemonConnectionPanel />)

    const input = screen.getByLabelText("Daemon address")
    fireEvent.change(input, { target: { value: "127.0.0.1:47321" } })
    fireEvent.click(screen.getByRole("button", { name: "Connect" }))

    await waitFor(() => expect(connectToDaemon).toHaveBeenCalledTimes(1))
    expect(connectToDaemon.mock.calls[0][0]).toBe("127.0.0.1:47321")
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it("shows the failure message and offers Retry without touching stored state", async () => {
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
    expect(reload).not.toHaveBeenCalled()
  })

  it("shows Connected status with Retry, Disconnect and Forget once daemon mode is active", async () => {
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })
    usePreferencesStore.setState({ adapterMode: "daemon" })

    render(<DaemonConnectionPanel />)

    await waitFor(() => {
      expect(
        screen.getByText("Connected to http://127.0.0.1:47321")
      ).toBeTruthy()
    })
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Forget" })).toBeTruthy()
  })

  it("calls disconnectDaemon and reloads when Disconnect is clicked", async () => {
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })
    usePreferencesStore.setState({ adapterMode: "daemon" })
    disconnectDaemon.mockResolvedValue(undefined)

    render(<DaemonConnectionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }))

    await waitFor(() => expect(disconnectDaemon).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it("calls forgetDaemon and reloads when Forget is clicked", async () => {
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })
    usePreferencesStore.setState({ adapterMode: "daemon" })
    forgetDaemon.mockResolvedValue(undefined)

    render(<DaemonConnectionPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "Forget" }))

    await waitFor(() => expect(forgetDaemon).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it("reveals the bearer-token field and install guide under Advanced", () => {
    render(<DaemonConnectionPanel />)

    expect(screen.queryByLabelText("Daemon bearer token")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }))
    expect(screen.getByLabelText("Daemon bearer token")).toBeTruthy()
    expect(screen.getByText(/bbb setup/)).toBeTruthy()
  })

  /**
   * `install.sh` is a bash script — `set -o pipefail` alone makes it one — and
   * `/bin/sh` is dash on Debian and Ubuntu, where `| sh` fails on the first
   * line with `set: Illegal option -o pipefail`. This is a command the user
   * copies and pastes verbatim, so the shell it names has to be one that can
   * actually run the script.
   */
  it("offers a Unix install command that runs the script with bash, not sh", () => {
    render(<DaemonConnectionPanel />)
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }))

    for (const platform of ["macOS", "Linux"]) {
      fireEvent.click(screen.getByRole("button", { name: platform }))
      const command = screen.getByText(/install\.sh/).textContent ?? ""
      expect(command, platform).toMatch(/install\.sh \| bash$/)
    }
  })
})
