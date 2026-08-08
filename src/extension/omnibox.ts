import type {
  DaemonSearchResponse,
  DaemonSearchResult,
} from "@/browser/daemon/client"
import { hasDaemonHostPermission } from "@/browser/daemon/permissions"
import {
  getAdapterModePreference,
  getDaemonConnectionConfig,
} from "@/browser/adapter-preference"
import type { BookmarkNode, DaemonConnectionConfig } from "@/browser/types"

export type OmniboxDisposition =
  | "currentTab"
  | "newForegroundTab"
  | "newBackgroundTab"

export interface OmniboxSuggestion {
  content: string
  description: string
}

export interface PersistedDaemonSelection {
  mode: "daemon"
  config: DaemonConnectionConfig
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
  getDaemonSelection(): Promise<PersistedDaemonSelection | null>
  hasHostPermission(): Promise<boolean>
  search(
    config: DaemonConnectionConfig,
    query: string,
    limit: number
  ): Promise<DaemonSearchResponse>
  fetchNode(config: DaemonConnectionConfig, id: string): Promise<BookmarkNode>
  navigate(url: string, disposition: OmniboxDisposition): Promise<void>
}

const SEARCH_LIMIT = 8
const OPAQUE_PREFIX = "bookmarks-but-better:"
const API_BASE = "/api/v1"

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

function suggestion(result: DaemonSearchResult): OmniboxSuggestion {
  return {
    content: opaqueSuggestionContent(result.id),
    description: `${escapeSuggestionDescription(result.title)} — <dim>${escapeSuggestionDescription(result.url)}</dim>`,
  }
}

function navigableUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null
  } catch {
    return null
  }
}

export function registerOmniboxListeners(facade: OmniboxFacade): void {
  let inputRevision = 0

  facade.setDefaultSuggestion("Search bookmarks in your local daemon")
  facade.onInputChanged((text, suggestResults) => {
    const revision = ++inputRevision
    const query = text.trim()
    if (!query) {
      suggestResults([])
      return
    }

    void (async () => {
      try {
        const selection = await facade.getDaemonSelection()
        if (!selection) {
          if (revision === inputRevision) suggestResults([])
          return
        }
        if (!(await facade.hasHostPermission())) {
          if (revision === inputRevision) suggestResults([])
          return
        }

        const response = await facade.search(
          selection.config,
          query,
          SEARCH_LIMIT
        )
        if (revision !== inputRevision) return
        suggestResults(response.results.slice(0, SEARCH_LIMIT).map(suggestion))
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
        const selection = await facade.getDaemonSelection()
        if (!selection) return
        if (!(await facade.hasHostPermission())) return
        const node = await facade.fetchNode(selection.config, id)
        const url = navigableUrl(node.url)
        if (!url) return
        await facade.navigate(url, disposition)
      } catch {
        // Omnibox navigation is best-effort. A stale/deleted result, revoked
        // permission, or stopped daemon leaves the current tab untouched.
      }
    })()
  })
}

async function getDaemonSelection(): Promise<PersistedDaemonSelection | null> {
  const [mode, config] = await Promise.all([
    getAdapterModePreference(),
    getDaemonConnectionConfig(),
  ])
  return mode === "daemon" && config ? { mode, config } : null
}

async function daemonRequest<T>(
  config: DaemonConnectionConfig,
  path: string
): Promise<T> {
  const response = await fetch(`${config.origin}${API_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      ...(config.bearerToken
        ? { Authorization: `Bearer ${config.bearerToken}` }
        : {}),
    },
  })
  if (!response.ok)
    throw new Error(`Daemon request failed (${response.status})`)
  return (await response.json()) as T
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
    getDaemonSelection,
    hasHostPermission: hasDaemonHostPermission,
    search(config, query, limit) {
      const params = new URLSearchParams({ q: query, limit: String(limit) })
      return daemonRequest<DaemonSearchResponse>(
        config,
        `/search?${params.toString()}`
      )
    },
    fetchNode(config, id) {
      return daemonRequest<BookmarkNode>(
        config,
        `/bookmarks/${encodeURIComponent(id)}`
      )
    },
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
