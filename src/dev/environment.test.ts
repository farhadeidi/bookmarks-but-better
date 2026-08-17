// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { describeSource } from "@/sources/descriptors"
import { devSourceEnvironment } from "./environment"
import { resetDevRuntime, setFaults } from "./runtime"

installFakeIndexedDB()

const ORIGIN = "http://127.0.0.1:52222"

beforeEach(() => {
  installFakeIndexedDB()
  vi.stubGlobal("location", { search: "", assign: vi.fn() })
  resetDevRuntime()
})

afterEach(() => {
  resetDevRuntime()
})

function daemonDescriptor(vaultId = "reading") {
  return describeSource(`daemon:${ORIGIN}#${vaultId}`, {
    enabled: true,
    origin: ORIGIN,
    vaultId,
    name: vaultId,
  })
}

describe("the dev environment", () => {
  it("answers capabilities from the default scenario", async () => {
    const env = await devSourceEnvironment()
    expect(env.capabilities()).toMatchObject({
      buildTarget: "chrome",
      browserSource: true,
      daemonSource: true,
    })
    expect(env.discoveryAtStartup).toBe(false)
  })

  it("builds browser adapters with browser capabilities", async () => {
    const env = await devSourceEnvironment()
    const adapter = await env.adapterFor(
      describeSource("browser", { enabled: true }),
      {}
    )
    expect(adapter.capabilities).toMatchObject({
      move: true,
      reorder: true,
      setChildOrder: false,
      rootIsCreatable: false,
    })
    const tree = await adapter.bookmarks.getTree()
    expect(tree[0]!.children!.map((c) => c.title)).toEqual([
      "Bookmarks Bar",
      "Other bookmarks",
    ])
  })

  it("builds daemon adapters with daemon capabilities and vault content", async () => {
    const env = await devSourceEnvironment()
    const adapter = await env.adapterFor(daemonDescriptor(), {
      [ORIGIN]: {},
    })
    expect(adapter.capabilities).toMatchObject({
      move: true,
      reorder: false,
      setChildOrder: true,
      rootIsCreatable: true,
    })
    const tree = await adapter.bookmarks.getTree()
    expect(JSON.stringify(tree)).toContain("SQLite is not a toy database")
  })

  it("keeps two vaults of one daemon apart", async () => {
    const env = await devSourceEnvironment()
    const reading = await env.adapterFor(
      daemonDescriptor(`daemon:${ORIGIN}#reading`),
      {}
    )
    const archive = await env.adapterFor(
      daemonDescriptor(`daemon:${ORIGIN}#archive`),
      {}
    )
    const readingTree = await reading.bookmarks.getTree()
    const archiveTree = await archive.bookmarks.getTree()
    expect(JSON.stringify(readingTree)).not.toBe(JSON.stringify(archiveTree))
  })

  it("connects to the scenario's simulated daemon without any network", async () => {
    const env = await devSourceEnvironment()
    const result = await env.connect("127.0.0.1:52222")
    expect(result).toMatchObject({
      ok: true,
      origin: ORIGIN,
      vaults: [
        { id: "reading", name: "reading" },
        { id: "archive", name: "archive" },
      ],
      legacyProtocol: false,
    })
  })

  it("connect refuses addresses no simulated daemon lives at", async () => {
    const env = await devSourceEnvironment()
    const result = await env.connect("127.0.0.1:59999")
    expect(result).toMatchObject({ ok: false, stage: "health" })
  })

  it("connect fails at the permission step when the control denies it", async () => {
    const env = await devSourceEnvironment()
    await setFaults({ permissionDenied: true })
    const result = await env.connect(ORIGIN)
    expect(result).toMatchObject({ ok: false, stage: "permission" })
  })

  it("connect fails at discovery when the control demands it", async () => {
    const env = await devSourceEnvironment()
    await setFaults({ discoveryFailure: true })
    const result = await env.connect(ORIGIN)
    expect(result).toMatchObject({ ok: false, stage: "discovery" })
  })

  it("connect fails at health while the daemon is offline", async () => {
    const env = await devSourceEnvironment()
    await setFaults({ daemonOnline: false })
    const result = await env.connect(ORIGIN)
    expect(result).toMatchObject({ ok: false, stage: "health" })
  })

  it("refreshDiscoveries reports the scenario's reachable daemons only", async () => {
    const env = await devSourceEnvironment()
    const discoveries = await env.refreshDiscoveries({
      [ORIGIN]: {},
      "http://127.0.0.1:59998": {},
    })
    expect(discoveries).toEqual([
      {
        origin: ORIGIN,
        vaults: [
          { id: "reading", name: "reading" },
          { id: "archive", name: "archive" },
        ],
        legacyProtocol: false,
      },
    ])

    await setFaults({ daemonOnline: false })
    expect(await env.refreshDiscoveries({ [ORIGIN]: {} })).toEqual([])
  })

  it("releasing daemon access is a no-op in the simulated world", async () => {
    const env = await devSourceEnvironment()
    await expect(env.releaseDaemonAccess()).resolves.toBeUndefined()
  })
})

describe("the daemon fault gate", () => {
  it("offline: the health probe reports not ready and reads fail", async () => {
    const env = await devSourceEnvironment()
    const adapter = await env.adapterFor(daemonDescriptor(), {})
    await setFaults({ daemonOnline: false })

    await expect(adapter.bookmarks.checkHealth!()).resolves.toMatchObject({
      ready: false,
    })
    await expect(adapter.bookmarks.getTree()).rejects.toThrow(/offline/)
  })

  it("mutation failure: writes are refused", async () => {
    const env = await devSourceEnvironment()
    const adapter = await env.adapterFor(daemonDescriptor(), {})
    await setFaults({ mutationFailure: true })

    const tree = await adapter.bookmarks.getTree()
    const root = tree[0]!
    await expect(
      adapter.bookmarks.create({ parentId: root.id, title: "Nope" })
    ).rejects.toThrow(/Simulated mutation failure/)
  })

  it("stale responses: writes are refused with the daemon's stale-revision problem code", async () => {
    const env = await devSourceEnvironment()
    const adapter = await env.adapterFor(daemonDescriptor(), {})
    await setFaults({ staleResponses: true })

    const tree = await adapter.bookmarks.getTree()
    const folder = tree[0]!.children![0]!
    const error = await adapter.bookmarks
      .update(folder.id, { title: "Nope" })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: "stale_revision" })
  })

  it("latency delays daemon operations", async () => {
    const env = await devSourceEnvironment()
    const adapter = await env.adapterFor(daemonDescriptor(), {})
    await setFaults({ daemonLatencyMs: 40 })

    const started = Date.now()
    await adapter.bookmarks.getTree()
    expect(Date.now() - started).toBeGreaterThanOrEqual(35)
  })

  it("change events fire through the adapter on mutations", async () => {
    const env = await devSourceEnvironment()
    const adapter = await env.adapterFor(daemonDescriptor(), {})
    const created = vi.fn()
    const unsubscribe = adapter.bookmarks.onCreated(created)

    const tree = await adapter.bookmarks.getTree()
    await adapter.bookmarks.create({
      parentId: tree[0]!.id,
      title: "New",
      url: "https://new.example",
    })
    expect(created).toHaveBeenCalledTimes(1)

    unsubscribe()
    await adapter.bookmarks.create({
      parentId: tree[0]!.id,
      title: "Unheard",
      url: "https://unheard.example",
    })
    expect(created).toHaveBeenCalledTimes(1)
  })
})
