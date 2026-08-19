import { DaemonClient } from "@/browser/daemon/client"
import { hasDaemonHostPermission } from "@/browser/daemon/permissions"
import { ChromeBookmarkAdapter } from "@/browser/chrome/bookmarks"
import type { BookmarkAdapter } from "@/browser/types"
import { searchBookmarks } from "@/lib/bookmark-search"
import { navigableUrl } from "@/lib/navigable-url"
import { loadSourceConfig } from "@/sources/persistence"
import { platformCapabilities } from "@/sources/platform"
import { describeSource, type SourceDescriptor } from "@/sources/descriptors"

export type OmniboxDisposition =
  | "currentTab"
  | "newForegroundTab"
  | "newBackgroundTab"

export interface OmniboxSuggestion {
  content: string
  description: string
}

/** One row the omnibox can show and open: never a folder, so never unopenable. */
export interface OmniboxResult {
  id: string
  title: string
  url: string
}

/**
 * The Active Source as the omnibox needs it: what to call it, how to search
 * it, and how to resolve a chosen row back to a URL.
 *
 * This is the whole reason the listener logic below names no source kind. A
 * Daemon Source searches server-side because it has an endpoint for it; a
 * source without one hands over its tree and is matched here. Which of those
 * a scope is stays behind this interface, and a scope is bound to exactly one
 * source, so nothing here can merge two.
 */
export interface OmniboxSearchScope {
  /** The source's label, shown so the user knows what is being searched. */
  label: string
  search(query: string, limit: number): Promise<OmniboxResult[]>
  /**
   * The current URL of `id` in this source, re-read at selection time.
   * `undefined` when it is gone, or turned out to be a folder.
   */
  lookupUrl(id: string): Promise<string | undefined>
}

export interface OmniboxFacade {
  onInputChanged(
    listener: (
      text: string,
      suggest: (suggestions: OmniboxSuggestion[]) => void
    ) => void
  ): void
  onInputEntered(
    listener: (text: string, disposition: OmniboxDisposition) => void
  ): void
  setDefaultSuggestion(description: string): void
  /**
   * The Active Source, resolved per event: an MV3 worker is stopped between
   * events, and the user can switch sources between two keystrokes. `null`
   * when nothing is searchable from here — no active source, or a daemon
   * whose host permission was never granted.
   */
  resolveActiveScope(): Promise<OmniboxSearchScope | null>
  navigate(url: string, disposition: OmniboxDisposition): Promise<void>
}

const SEARCH_LIMIT = 8
const OPAQUE_PREFIX = "bookmarks-but-better:"

/** Shown before any query has resolved a source to name. */
const DEFAULT_DESCRIPTION = "Search your bookmarks"

export function escapeSuggestionDescription(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function encodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeUtf8(value: string): string {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function opaqueSuggestionContent(id: string): string {
  return `${OPAQUE_PREFIX}${encodeUtf8(id)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}`
}

export function decodeOpaqueSuggestion(content: string): string | null {
  if (!content.startsWith(OPAQUE_PREFIX)) return null
  const token = content.slice(OPAQUE_PREFIX.length)
  if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) return null

  try {
    const base64 = token.replaceAll("-", "+").replaceAll("_", "/")
    const padding = "=".repeat((4 - (base64.length % 4)) % 4)
    const id = decodeUtf8(base64 + padding)
    return id || null
  } catch {
    return null
  }
}

function suggestion(result: OmniboxResult): OmniboxSuggestion {
  return {
    content: opaqueSuggestionContent(result.id),
    description: `${escapeSuggestionDescription(result.title)} — <dim>${escapeSuggestionDescription(result.url)}</dim>`,
  }
}

export function registerOmniboxListeners(facade: OmniboxFacade): void {
  let inputRevision = 0
  let description = DEFAULT_DESCRIPTION

  facade.setDefaultSuggestion(description)

  /**
   * Names the source the next Enter would search. The Active Source is
   * profile-wide and another surface can switch it between two keystrokes, so
   * this follows whatever the current query resolved rather than being read
   * once at registration. The description is markup, exactly like a
   * suggestion's, so a source label carries no less escaping.
   */
  function describeScope(scope: OmniboxSearchScope | null): void {
    const next = scope
      ? `Search ${escapeSuggestionDescription(scope.label)}`
      : DEFAULT_DESCRIPTION
    if (next === description) return
    description = next
    facade.setDefaultSuggestion(next)
  }

  facade.onInputChanged((text, suggestResults) => {
    const revision = ++inputRevision
    const query = text.trim()
    if (!query) {
      suggestResults([])
      return
    }

    void (async () => {
      try {
        const scope = await facade.resolveActiveScope()
        describeScope(scope)
        if (!scope) {
          if (revision === inputRevision) suggestResults([])
          return
        }

        const results = await scope.search(query, SEARCH_LIMIT)
        if (revision !== inputRevision) return
        suggestResults(results.slice(0, SEARCH_LIMIT).map(suggestion))
      } catch {
        if (revision === inputRevision) suggestResults([])
      }
    })()
  })

  facade.onInputEntered((text, disposition) => {
    const id = decodeOpaqueSuggestion(text)
    if (!id) return

    void (async () => {
      try {
        const scope = await facade.resolveActiveScope()
        if (!scope) return
        const url = navigableUrl(await scope.lookupUrl(id))
        if (!url) return
        await facade.navigate(url, disposition)
      } catch {
        // Omnibox navigation is best-effort. A stale/deleted result, revoked
        // permission, or stopped daemon leaves the current tab untouched.
      }
    })()
  })
}

/**
 * A scope over a source that hands out its whole tree.
 *
 * The Browser Source has no search endpoint to ask, so matching happens here,
 * over the same `searchBookmarks` the in-page palette uses — one ranking for
 * both surfaces, and one place to change it. The tree is re-read per query
 * because an MV3 worker owns nothing across events, and because a bookmark
 * created since the last keystroke should still be findable.
 */
function treeScope(
  label: string,
  adapter: BookmarkAdapter
): OmniboxSearchScope {
  return {
    label,
    async search(query, limit) {
      const tree = await adapter.getTree()
      return (
        searchBookmarks(tree, query)
          // Folders match too, and Enter has nowhere to take them. Dropping
          // them before the limit keeps a folder-heavy match from filling all
          // eight rows with things that cannot be opened.
          .flatMap((hit) =>
            hit.url ? [{ id: hit.id, title: hit.title, url: hit.url }] : []
          )
          .slice(0, limit)
      )
    },
    async lookupUrl(id) {
      const [node] = await adapter.getSubTree(id)
      return node?.url
    },
  }
}

/**
 * A scope over one daemon Vault, or `null` when it cannot be reached.
 *
 * The daemon searches its own snapshot server-side, which beats pulling a
 * whole vault over loopback on every keystroke. The host permission is
 * optional and granted only at Connect, so a profile that never connected —
 * or revoked it — resolves no scope rather than firing a blocked request.
 */
async function daemonScope(
  source: SourceDescriptor,
  connection: { bearerToken?: string } | undefined
): Promise<OmniboxSearchScope | null> {
  if (!source.origin || !connection) return null
  if (!(await hasDaemonHostPermission())) return null

  const client = new DaemonClient({
    origin: source.origin,
    bearerToken: connection.bearerToken,
    // A daemon that predates Vault ids is reached unscoped: scoping would aim
    // every request at a route it does not serve.
    vaultId: source.unscoped ? null : (source.vaultId ?? null),
  })

  return {
    label: source.label,
    async search(query, limit) {
      const response = await client.search(query, limit)
      return response.results
    },
    async lookupUrl(id) {
      return (await client.fetchNode(id)).url
    },
  }
}

/**
 * The Active Source, read from the same persisted Source Configuration the
 * dashboard and popup use — that sharing is what makes the active source
 * profile-wide rather than per-surface, and what keeps the omnibox pointed at
 * exactly the source the rest of the profile is showing.
 */
async function resolveActiveScope(): Promise<OmniboxSearchScope | null> {
  const config = await loadSourceConfig(platformCapabilities())
  const activeId = config.activeSourceId
  if (!activeId) return null
  const entry = config.sources[activeId]
  if (!entry?.enabled) return null

  const source = describeSource(activeId, entry)
  switch (source.kind) {
    case "browser":
      // Firefox's adapter differs from Chrome's only in `openInManager`,
      // which no omnibox path calls, so the Chromium one serves both here and
      // the worker bundle carries no adapter selection at all.
      return treeScope(source.label, new ChromeBookmarkAdapter())
    case "standalone":
      // The retiring Standalone Source stays out of the worker: its adapter
      // is the one that seeds itself from `src/dev/seed-bookmarks.json`, and
      // the IIFE background bundle inlines that dynamic import whole — a
      // 14 kB worker becoming 41 kB, permanently, for a source that is being
      // removed. Its profiles still search from the in-page palette.
      return null
    case "daemon":
      return daemonScope(source, config.connections[source.origin ?? ""])
  }
}

export function createBrowserOmniboxFacade(): OmniboxFacade {
  return {
    onInputChanged(listener) {
      chrome.omnibox.onInputChanged.addListener(listener)
    },
    onInputEntered(listener) {
      chrome.omnibox.onInputEntered.addListener(listener)
    },
    setDefaultSuggestion(description) {
      chrome.omnibox.setDefaultSuggestion({ description })
    },
    resolveActiveScope,
    async navigate(url, disposition) {
      if (disposition === "currentTab") {
        await chrome.tabs.update({ url })
        return
      }
      await chrome.tabs.create({
        url,
        active: disposition === "newForegroundTab",
      })
    },
  }
}
