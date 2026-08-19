// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { saveSourceConfig } from "@/sources/persistence"
import { daemonSourceId } from "@/sources/config"
import type { BookmarkNode } from "@/browser/types"
import {
  decodeOpaqueSuggestion,
  createBrowserOmniboxFacade,
  escapeSuggestionDescription,
  opaqueSuggestionContent,
  registerOmniboxListeners,
  type OmniboxDisposition,
  type OmniboxFacade,
  type OmniboxResult,
  type OmniboxSearchScope,
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

/**
 * A scope standing in for whichever source is active: the listener logic is
 * the same code for a Daemon Source and a Browser Source, so the tests below
 * exercise it once through this and pin the per-source wiring separately
 * against the real facade.
 */
function fakeScope(label = "Browser bookmarks") {
  return {
    label,
    search: vi.fn<OmniboxSearchScope["search"]>().mockResolvedValue([]),
    lookupUrl: vi.fn<OmniboxSearchScope["lookupUrl"]>(),
  }
}

function fakeFacade(scope: OmniboxSearchScope | null = fakeScope()) {
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
    resolveActiveScope: vi.fn().mockResolvedValue(scope),
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

  it("does nothing unless a searchable active source is present", async () => {
    const fake = fakeFacade(null)
    registerOmniboxListeners(fake.facade)
    const suggest = vi.fn()

    fake.changed()("rust", suggest)
    await flush()

    expect(suggest).toHaveBeenCalledWith([])
  })

  it("names the source being searched once one resolves", async () => {
    const scope = fakeScope("Kitchen & <sink>")
    const fake = fakeFacade(scope)
    registerOmniboxListeners(fake.facade)

    expect(fake.facade.setDefaultSuggestion).toHaveBeenLastCalledWith(
      "Search your bookmarks"
    )

    fake.changed()("rust", vi.fn())
    await flush()
    fake.changed()("rustup", vi.fn())
    await flush()

    // Escaped like any other description, and set once rather than per
    // keystroke: the source only changes when the user switches it.
    expect(fake.facade.setDefaultSuggestion).toHaveBeenLastCalledWith(
      "Search Kitchen &amp; &lt;sink&gt;"
    )
    expect(fake.facade.setDefaultSuggestion).toHaveBeenCalledTimes(2)
  })

  it("ignores stale asynchronous results and escapes description text", async () => {
    const scope = fakeScope()
    const fake = fakeFacade(scope)
    const first = deferred<OmniboxResult[]>()
    const second = deferred<OmniboxResult[]>()
    scope.search.mockReturnValueOnce(first.promise)
    scope.search.mockReturnValueOnce(second.promise)
    registerOmniboxListeners(fake.facade)
    const oldSuggest = vi.fn()
    const newSuggest = vi.fn()

    fake.changed()("old", oldSuggest)
    await flush()
    fake.changed()("new", newSuggest)
    await flush()
    second.resolve([
      {
        id: "opaque/id",
        title: "<script>& title",
        url: "https://example.com/?a=<b>",
      },
    ])
    await flush()
    first.resolve([{ id: "old", title: "Old", url: "https://old.example" }])
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
      const scope = fakeScope()
      const fake = fakeFacade(scope)
      scope.lookupUrl.mockResolvedValue("https://example.com")
      registerOmniboxListeners(fake.facade)

      fake.entered()(opaqueSuggestionContent("bookmark-1"), disposition)
      await flush()

      expect(scope.lookupUrl).toHaveBeenCalledWith("bookmark-1")
      expect(fake.facade.navigate).toHaveBeenCalledWith(
        "https://example.com/",
        disposition
      )
    }
  )

  it("does nothing for free-form unselected input", async () => {
    const scope = fakeScope()
    const fake = fakeFacade(scope)
    registerOmniboxListeners(fake.facade)

    fake.entered()("just some words", "currentTab")
    await flush()

    expect(fake.facade.resolveActiveScope).not.toHaveBeenCalled()
    expect(scope.lookupUrl).not.toHaveBeenCalled()
    expect(fake.facade.navigate).not.toHaveBeenCalled()
  })

  it("does not navigate when the selected node became a folder or unsafe URL", async () => {
    const scope = fakeScope()
    const fake = fakeFacade(scope)
    scope.lookupUrl.mockResolvedValue("javascript:alert(1)")
    registerOmniboxListeners(fake.facade)

    fake.entered()(opaqueSuggestionContent("bookmark-1"), "currentTab")
    await flush()

    expect(fake.facade.navigate).not.toHaveBeenCalled()

    scope.lookupUrl.mockResolvedValue(undefined)
    fake.entered()(opaqueSuggestionContent("folder-1"), "currentTab")
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

const BROWSER_TREE: BookmarkNode[] = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "bar",
        title: "Rust things",
        children: [
          {
            id: "book",
            title: "The Rust Book",
            url: "https://doc.rust-lang.org",
          },
          { id: "crates", title: "Crates", url: "https://crates.io" },
        ],
      },
    ],
  },
]

function stubBookmarksApi() {
  return {
    getTree: vi.fn().mockResolvedValue(BROWSER_TREE),
    getSubTree: vi.fn().mockResolvedValue([
      {
        id: "book",
        title: "The Rust Book",
        url: "https://doc.rust-lang.org",
      },
    ]),
  }
}

describe("browser omnibox facade", () => {
  it("searches the Browser Source's own tree when it is active", async () => {
    const bookmarks = stubBookmarksApi()
    // `storage` too: the Browser Source only exists where both APIs do.
    vi.stubGlobal("chrome", { bookmarks, storage: {}, omnibox: {}, tabs: {} })
    await saveSourceConfig({
      version: 2,
      connections: {},
      sources: { browser: { enabled: true, label: "My bookmarks" } },
      activeSourceId: "browser",
    })

    const scope = await createBrowserOmniboxFacade().resolveActiveScope()

    expect(scope?.label).toBe("My bookmarks")
    // "Rust things" is a folder and matches too; only openable rows survive.
    await expect(scope?.search("rust", 8)).resolves.toEqual([
      {
        id: "book",
        title: "The Rust Book",
        url: "https://doc.rust-lang.org",
      },
    ])
    await expect(scope?.lookupUrl("book")).resolves.toBe(
      "https://doc.rust-lang.org"
    )
    expect(bookmarks.getSubTree).toHaveBeenCalledWith("book")
  })

  it("reads the active daemon source from the shared Source Configuration", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [] }),
    })
    vi.stubGlobal("fetch", fetchImpl)
    const facade = createBrowserOmniboxFacade()
    const origin = "http://localhost:52222"

    // No source at all: nothing for the omnibox to search.
    await saveSourceConfig({
      version: 2,
      connections: { [origin]: { bearerToken: "secret" } },
      sources: {},
      activeSourceId: null,
    })
    await expect(facade.resolveActiveScope()).resolves.toBeNull()

    // The daemon vault active: every request carries that connection's
    // credentials and is scoped to that vault, never another source's.
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

    const scope = await facade.resolveActiveScope()
    expect(scope?.label).toBe("reading · localhost:52222")
    await expect(scope?.search("rust", 8)).resolves.toEqual([])

    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ]
    expect(url).toBe(
      "http://localhost:52222/api/v1/vaults/reading/search?q=rust&limit=8"
    )
    expect(init.headers.Authorization).toBe("Bearer secret")
  })

  it("resolves no scope while the daemon host permission is missing", async () => {
    const contains = vi.fn(
      (
        _permissions: chrome.permissions.Permissions,
        callback: (granted: boolean) => void
      ) => callback(false)
    )
    vi.stubGlobal("chrome", {
      permissions: { contains },
      omnibox: {},
      tabs: {},
    })
    const origin = "http://127.0.0.1:52222"
    const id = daemonSourceId(origin, "main")
    await saveSourceConfig({
      version: 2,
      connections: { [origin]: {} },
      sources: { [id]: { enabled: true, origin, vaultId: "main" } },
      activeSourceId: id,
    })

    await expect(
      createBrowserOmniboxFacade().resolveActiveScope()
    ).resolves.toBeNull()
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
