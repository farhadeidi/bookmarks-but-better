// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { saveSourceConfig } from "@/sources/persistence"
import { daemonSourceId } from "@/sources/config"
import type { DaemonSearchResponse } from "@/browser/daemon/client"
import type { BookmarkNode } from "@/browser/types"
import {
  decodeOpaqueSuggestion,
  createBrowserOmniboxFacade,
  escapeSuggestionDescription,
  opaqueSuggestionContent,
  registerOmniboxListeners,
  type OmniboxDisposition,
  type OmniboxFacade,
  type OmniboxSuggestion,
} from "./omnibox"

installFakeIndexedDB()

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function fakeFacade() {
  let changed:
    | ((text: string, suggest: (items: OmniboxSuggestion[]) => void) => void)
    | undefined
  let entered:
    | ((text: string, disposition: OmniboxDisposition) => void)
    | undefined
  const facade: OmniboxFacade = {
    onInputChanged: vi.fn((listener) => {
      changed = listener
    }),
    onInputEntered: vi.fn((listener) => {
      entered = listener
    }),
    setDefaultSuggestion: vi.fn(),
    getDaemonSelection: vi.fn().mockResolvedValue({
      config: { origin: "http://127.0.0.1:52222" },
      vaultId: "main",
    }),
    hasHostPermission: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue({ results: [] }),
    fetchNode: vi.fn(),
    navigate: vi.fn(),
  }
  return {
    facade,
    changed: () => changed!,
    entered: () => entered!,
  }
}

describe("omnibox listener registration", () => {
  it("registers both listeners synchronously", () => {
    const fake = fakeFacade()
    registerOmniboxListeners(fake.facade)

    expect(fake.facade.onInputChanged).toHaveBeenCalledOnce()
    expect(fake.facade.onInputEntered).toHaveBeenCalledOnce()
    expect(fake.facade.setDefaultSuggestion).toHaveBeenCalledOnce()
  })

  it("does nothing unless an active daemon source and permission are both present", async () => {
    const fake = fakeFacade()
    vi.mocked(fake.facade.getDaemonSelection).mockResolvedValue(null)
    registerOmniboxListeners(fake.facade)
    const suggest = vi.fn()

    fake.changed()("rust", suggest)
    await flush()

    expect(fake.facade.search).not.toHaveBeenCalled()
    expect(suggest).toHaveBeenCalledWith([])
  })

  it("ignores stale asynchronous results and escapes description text", async () => {
    const fake = fakeFacade()
    const first = deferred<DaemonSearchResponse>()
    const second = deferred<DaemonSearchResponse>()
    vi.mocked(fake.facade.search)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    registerOmniboxListeners(fake.facade)
    const oldSuggest = vi.fn()
    const newSuggest = vi.fn()

    fake.changed()("old", oldSuggest)
    await flush()
    fake.changed()("new", newSuggest)
    await flush()
    second.resolve({
      results: [
        {
          id: "opaque/id",
          title: "<script>& title",
          url: "https://example.com/?a=<b>",
        },
      ],
    })
    await flush()
    first.resolve({
      results: [{ id: "old", title: "Old", url: "https://old.example" }],
    })
    await flush()

    expect(oldSuggest).not.toHaveBeenCalled()
    expect(newSuggest).toHaveBeenCalledOnce()
    const [items] = newSuggest.mock.calls[0] as [OmniboxSuggestion[]]
    expect(items[0].description).toBe(
      "&lt;script&gt;&amp; title — <dim>https://example.com/?a=&lt;b&gt;</dim>"
    )
    expect(items[0].content).not.toContain("opaque/id")
    expect(decodeOpaqueSuggestion(items[0].content)).toBe("opaque/id")
  })
})

describe("omnibox selection", () => {
  it.each(["currentTab", "newForegroundTab", "newBackgroundTab"] as const)(
    "re-fetches the opaque id before %s navigation",
    async (disposition) => {
      const fake = fakeFacade()
      const node: BookmarkNode = {
        id: "bookmark-1",
        title: "Example",
        url: "https://example.com",
      }
      vi.mocked(fake.facade.fetchNode).mockResolvedValue(node)
      registerOmniboxListeners(fake.facade)

      fake.entered()(opaqueSuggestionContent(node.id), disposition)
      await flush()

      expect(fake.facade.fetchNode).toHaveBeenCalledWith(
        {
          config: { origin: "http://127.0.0.1:52222" },
          vaultId: "main",
        },
        node.id
      )
      expect(fake.facade.navigate).toHaveBeenCalledWith(
        node.url + "/",
        disposition
      )
    }
  )

  it("does nothing for free-form unselected input", async () => {
    const fake = fakeFacade()
    registerOmniboxListeners(fake.facade)

    fake.entered()("just some words", "currentTab")
    await flush()

    expect(fake.facade.getDaemonSelection).not.toHaveBeenCalled()
    expect(fake.facade.fetchNode).not.toHaveBeenCalled()
    expect(fake.facade.navigate).not.toHaveBeenCalled()
  })

  it("does not navigate when the selected node became a folder or unsafe URL", async () => {
    const fake = fakeFacade()
    vi.mocked(fake.facade.fetchNode).mockResolvedValue({
      id: "bookmark-1",
      title: "Changed",
      url: "javascript:alert(1)",
    })
    registerOmniboxListeners(fake.facade)

    fake.entered()(opaqueSuggestionContent("bookmark-1"), "currentTab")
    await flush()

    expect(fake.facade.navigate).not.toHaveBeenCalled()
  })
})

describe("omnibox encoding", () => {
  it("round-trips unicode ids and rejects unrelated text", () => {
    const content = opaqueSuggestionContent("é/书签")
    expect(decodeOpaqueSuggestion(content)).toBe("é/书签")
    expect(decodeOpaqueSuggestion("not a selection")).toBeNull()
  })

  it("escapes all XML-significant characters", () => {
    expect(escapeSuggestionDescription(`<&>"'`)).toBe(
      "&lt;&amp;&gt;&quot;&apos;"
    )
  })
})

describe("browser omnibox facade", () => {
  it("reads the active daemon source from the shared Source Configuration", async () => {
    const facade = createBrowserOmniboxFacade()
    const origin = "http://localhost:52222"

    // Browser active: nothing for the omnibox to search.
    await saveSourceConfig({
      version: 2,
      connections: { [origin]: { bearerToken: "secret" } },
      sources: { browser: { enabled: true } },
      activeSourceId: "browser",
    })
    await expect(facade.getDaemonSelection()).resolves.toBeNull()

    // The daemon vault active: the selection carries the connection and the
    // vault scope, canonicalized the same way everywhere.
    const id = daemonSourceId(origin, "reading")
    await saveSourceConfig({
      version: 2,
      connections: { [origin]: { bearerToken: "secret" } },
      sources: {
        browser: { enabled: true },
        [id]: { enabled: true, origin, vaultId: "reading" },
      },
      activeSourceId: id,
    })
    await expect(facade.getDaemonSelection()).resolves.toEqual({
      config: { origin, bearerToken: "secret" },
      vaultId: "reading",
    })
  })

  it("reuses the daemon permission check for both allowed loopback hosts", async () => {
    const contains = vi.fn(
      (
        _permissions: chrome.permissions.Permissions,
        callback: (granted: boolean) => void
      ) => callback(true)
    )
    vi.stubGlobal("chrome", {
      permissions: { contains },
      omnibox: {},
      tabs: {},
    })

    await expect(
      createBrowserOmniboxFacade().hasHostPermission()
    ).resolves.toBe(true)
    expect(contains).toHaveBeenCalledWith(
      { origins: ["http://127.0.0.1/*", "http://localhost/*"] },
      expect.any(Function)
    )
  })

  it("maps all three dispositions to current, foreground, and background tabs", async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const create = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("chrome", {
      tabs: { update, create },
      omnibox: {},
      permissions: {},
      runtime: {},
    })
    const facade = createBrowserOmniboxFacade()

    await facade.navigate("https://current.example/", "currentTab")
    await facade.navigate("https://foreground.example/", "newForegroundTab")
    await facade.navigate("https://background.example/", "newBackgroundTab")

    expect(update).toHaveBeenCalledWith({ url: "https://current.example/" })
    expect(create).toHaveBeenNthCalledWith(1, {
      url: "https://foreground.example/",
      active: true,
    })
    expect(create).toHaveBeenNthCalledWith(2, {
      url: "https://background.example/",
      active: false,
    })
  })
})
