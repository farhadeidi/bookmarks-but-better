// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useSourceStore } from "@/stores/source-store"
import { StandaloneMigrationDialog } from "./standalone-migration-dialog"

installFakeIndexedDB()

// The dialog's defect was wiring, not the migration pipeline: the real
// plan/run functions stay, and only the Standalone read is pinned so the
// test controls what there is to copy.
vi.mock("./standalone-migration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./standalone-migration")>()
  return {
    ...actual,
    readStandaloneTree: vi.fn(),
  }
})

vi.mock("@/sources/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/adapters")>()
  return {
    ...actual,
    createAdapterForSource: vi.fn(),
  }
})

const { createAdapterForSource } = await import("@/sources/adapters")
const { readStandaloneTree } = await import("./standalone-migration")

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** One bookmark awaiting copy, as the Standalone collection would serve it. */
function standaloneTree(): BookmarkNode[] {
  return [
    {
      id: "s0",
      title: "Standalone",
      children: [{ id: "s1", title: "Rust", url: "https://rust-lang.org" }],
    },
  ]
}

/**
 * A Chrome-shaped destination: root "0" (not creatable), Bookmarks Bar
 * "1" (the default import parent), Other Bookmarks "2". `getTree` reflects
 * everything `create` wrote, so the dialog's verification re-read sees it.
 */
function destinationFixture() {
  const created: { parentId: string; title: string; url?: string }[] = []
  const nodeOf = (
    request: { title: string; url?: string },
    index: number
  ): BookmarkNode =>
    request.url
      ? { id: `n${index}`, title: request.title, url: request.url }
      : { id: `n${index}`, title: request.title, children: [] }
  const treeOf = (): BookmarkNode[] => [
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          title: "Bookmarks Bar",
          children: created.filter((c) => c.parentId === "1").map(nodeOf),
        },
        {
          id: "2",
          title: "Other Bookmarks",
          children: created.filter((c) => c.parentId === "2").map(nodeOf),
        },
      ],
    },
  ]
  const adapter: BrowserAdapter = {
    bookmarks: {
      getTree: vi.fn(async () => treeOf()),
      getSubTree: vi.fn(async () => []),
      create: vi.fn(async (request) => {
        created.push(request)
        return nodeOf(request, created.length)
      }),
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
    favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
    capabilities: {
      openInManager: false,
      move: true,
      reorder: true,
      setChildOrder: false,
      rootIsCreatable: false,
    },
  }
  return { adapter, created }
}

beforeEach(() => {
  installFakeIndexedDB()
  vi.clearAllMocks()
  vi.stubGlobal("ResizeObserver", StubResizeObserver)
  // The profile the sunset addresses: Standalone is the legacy Active
  // Source, Browser bookmarks are available as the destination.
  useSourceStore.setState({
    status: "ready",
    switching: false,
    lastSwitchError: null,
    activeSourceId: "standalone",
    config: {
      version: 2,
      connections: {},
      sources: {
        browser: { enabled: true },
        standalone: { enabled: true, legacy: true },
      },
      activeSourceId: "standalone",
    },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mockDestination(destination: BrowserAdapter) {
  vi.mocked(createAdapterForSource).mockImplementation((source) => {
    if (source.id !== "browser") {
      throw new Error(`unexpected destination ${source.id}`)
    }
    return destination
  })
}

describe("StandaloneMigrationDialog", () => {
  it("copies into the resolved default folder when no folder was chosen", async () => {
    const user = userEvent.setup()
    const destination = destinationFixture()
    vi.mocked(readStandaloneTree).mockResolvedValue(standaloneTree())
    mockDestination(destination.adapter)

    render(<StandaloneMigrationDialog open onOpenChange={() => {}} />)

    // The primary path: leave the folder on the default, preview, copy.
    await user.click(screen.getByRole("button", { name: "Preview the copy" }))
    expect(await screen.findByText("Ready to copy")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Copy now" }))
    expect(await screen.findByText("Copy verified")).toBeTruthy()

    // The plan's default target — Bookmarks Bar — is what the copy used.
    expect(destination.created.map((c) => c.parentId)).toEqual(["1"])
    expect(
      (destination.adapter.bookmarks.create as ReturnType<typeof vi.fn>).mock
        .calls[0][0]
    ).toMatchObject({ title: "Rust", url: "https://rust-lang.org" })
  })

  it("copies into the folder chosen explicitly after a first preview", async () => {
    const user = userEvent.setup()
    const destination = destinationFixture()
    vi.mocked(readStandaloneTree).mockResolvedValue(standaloneTree())
    mockDestination(destination.adapter)

    render(<StandaloneMigrationDialog open onOpenChange={() => {}} />)

    // Folder options only exist once something has been previewed.
    await user.click(screen.getByRole("button", { name: "Preview the copy" }))
    expect(await screen.findByText("Ready to copy")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Back" }))
    await user.click(
      screen.getByRole("combobox", { name: "Destination folder" })
    )
    await user.click(
      await screen.findByRole("option", { name: "Other Bookmarks" })
    )
    await user.click(screen.getByRole("button", { name: "Preview the copy" }))
    expect(await screen.findByText("Ready to copy")).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Copy now" }))
    expect(await screen.findByText("Copy verified")).toBeTruthy()

    expect(destination.created.map((c) => c.parentId)).toEqual(["2"])
  })
})
