import type { BrowserAdapter } from "@/browser/types"
import { loadSourceConfig, saveSourceConfig } from "@/sources/persistence"
import { setActiveSource } from "@/sources/config"
import { createAdapterForSource } from "@/sources/adapters"
import { describeSource, type SourceDescriptor } from "@/sources/descriptors"
import { platformCapabilities } from "@/sources/platform"
import {
  buildRootFolderOptions,
  resolveCreateParentId,
  type RootFolderOption,
} from "@/features/root-folder-select"

export interface ActiveTab {
  title?: string
  url?: string
}

/** What the popup needs to know about the profile's source situation. */
export interface CaptureSelection {
  adapter: BrowserAdapter | null
  /** The active source's descriptor, for labelling the destination. */
  source: SourceDescriptor | null
  /** Enabled sources, for the quick-change control. */
  choices: SourceDescriptor[]
}

export interface CaptureControllerDependencies {
  getActiveTab(): Promise<ActiveTab | null>
  selectAdapter(): Promise<CaptureSelection>
  /** Persists a new Active Source selection for the whole profile. */
  persistActiveSource(id: string): Promise<boolean>
}

export type CapturePhase =
  | "loading"
  | "ready"
  | "submitting"
  | "success"
  | "error"

export interface CaptureSnapshot {
  phase: CapturePhase
  title: string
  url: string
  folders: RootFolderOption[]
  folderId: string
  /** The active source's id; `""` until one resolves. */
  sourceId: string
  sourceLabel: string
  /** Enabled sources when more than one exists; drives the quick change. */
  choices: SourceDescriptor[]
  message: string | null
}

const INITIAL_SNAPSHOT: CaptureSnapshot = {
  phase: "loading",
  title: "",
  url: "",
  folders: [],
  folderId: "",
  sourceId: "",
  sourceLabel: "",
  choices: [],
  message: null,
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The bookmark could not be saved."
}

function parseCapturableUrl(value: string | undefined): URL | null {
  if (!value) return null

  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

function readableTitle(tab: ActiveTab, url: URL): string {
  const title = tab.title?.trim()
  return title || url.hostname || url.href
}

function ensureSelectedFolderOption(
  folders: RootFolderOption[],
  folderId: string
): RootFolderOption[] {
  if (folders.some((folder) => folder.id === folderId)) return folders
  return [{ id: folderId, label: "Bookmarks" }, ...folders]
}

/**
 * Resolves the profile's Active Source from persisted configuration.
 *
 * The popup is its own context with no live source store: it reads the same
 * Source Configuration the dashboard wrote, which is what makes the Active
 * Source profile-wide rather than per-surface.
 */
export async function selectCurrentAdapter(): Promise<CaptureSelection> {
  const caps = platformCapabilities()
  const config = await loadSourceConfig(caps)
  const choices = Object.entries(config.sources)
    .filter(([, entry]) => entry.enabled)
    .map(([id, entry]) => describeSource(id, entry))
    .sort((a, b) => a.label.localeCompare(b.label))

  const activeId = config.activeSourceId
  if (!activeId || !config.sources[activeId]?.enabled) {
    return { adapter: null, source: null, choices }
  }

  const source = describeSource(activeId, config.sources[activeId])
  const adapter = createAdapterForSource(source, config.connections)
  return { adapter, source, choices }
}

export async function getCurrentTab(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ? { title: tab.title, url: tab.url } : null
}

/** Persists the Active Source selection, shared with the dashboard. */
export async function persistActiveSourceSelection(
  id: string
): Promise<boolean> {
  const caps = platformCapabilities()
  const config = await loadSourceConfig(caps)
  const next = setActiveSource(config, id)
  if (!next) return false
  await saveSourceConfig(next)
  return true
}

export function createCaptureDependencies(): CaptureControllerDependencies {
  return {
    getActiveTab: getCurrentTab,
    selectAdapter: selectCurrentAdapter,
    persistActiveSource: persistActiveSourceSelection,
  }
}

export class CaptureController {
  private snapshot: CaptureSnapshot = INITIAL_SNAPSHOT
  private adapter: BrowserAdapter | null = null
  private disposed = false
  private listeners = new Set<(snapshot: CaptureSnapshot) => void>()
  private readonly dependencies: CaptureControllerDependencies

  constructor(dependencies: CaptureControllerDependencies) {
    this.dependencies = dependencies
  }

  getSnapshot(): CaptureSnapshot {
    return this.snapshot
  }

  subscribe(listener: (snapshot: CaptureSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  private publish(next: CaptureSnapshot): void {
    if (this.disposed) return
    this.snapshot = next
    for (const listener of this.listeners) listener(next)
  }

  async initialize(): Promise<void> {
    try {
      const tab = await this.dependencies.getActiveTab()
      const url = parseCapturableUrl(tab?.url)
      if (!tab || !url) {
        this.publish({
          ...INITIAL_SNAPSHOT,
          phase: "error",
          message:
            "This page cannot be bookmarked. Open a regular http or https page and try again.",
        })
        return
      }

      const selection = await this.dependencies.selectAdapter()
      if (this.disposed) {
        selection.adapter?.bookmarks.dispose?.()
        return
      }
      this.adapter = selection.adapter

      if (!selection.adapter || !selection.source) {
        this.publish({
          ...INITIAL_SNAPSHOT,
          title: readableTitle(tab, url),
          url: url.href,
          choices: selection.choices,
          phase: "error",
          message:
            "No bookmark source is enabled. Open the dashboard settings to connect one.",
        })
        return
      }

      if (selection.adapter.bookmarks.checkHealth) {
        const health = await selection.adapter.bookmarks.checkHealth()
        if (!health.ready) {
          throw new Error(
            "The active bookmark source is not ready. Change the destination or retry."
          )
        }
      }

      const [tree, rootFolderId] = await Promise.all([
        selection.adapter.bookmarks.getTree(),
        selection.adapter.storage.get<string>("rootFolderId"),
      ])
      const folderId = resolveCreateParentId(
        tree,
        rootFolderId,
        selection.adapter.capabilities.rootIsCreatable ?? false
      )
      if (!folderId) {
        throw new Error("The selected bookmark source has no writable folder.")
      }

      const folders = ensureSelectedFolderOption(
        buildRootFolderOptions(tree),
        folderId
      )
      this.publish({
        phase: "ready",
        title: readableTitle(tab, url),
        url: url.href,
        folders,
        folderId,
        sourceId: selection.source.id,
        sourceLabel: selection.source.label,
        choices: selection.choices,
        message: null,
      })
    } catch (error) {
      this.publish({
        ...INITIAL_SNAPSHOT,
        phase: "error",
        message: errorMessage(error),
      })
    }
  }

  /**
   * Quick change: persists a new Active Source for the whole profile and
   * re-runs initialization against it. The destination label updates with
   * everything else.
   */
  async switchSource(id: string): Promise<void> {
    if (this.snapshot.phase === "submitting") return
    const applied = await this.dependencies.persistActiveSource(id)
    if (!applied || this.disposed) return
    this.adapter?.bookmarks.dispose?.()
    this.adapter = null
    this.publish({ ...INITIAL_SNAPSHOT, choices: this.snapshot.choices })
    await this.initialize()
  }

  setTitle(title: string): void {
    if (this.snapshot.phase !== "ready") return
    this.publish({ ...this.snapshot, title })
  }

  setFolderId(folderId: string): void {
    if (this.snapshot.phase !== "ready") return
    if (!this.snapshot.folders.some((folder) => folder.id === folderId)) return
    this.publish({ ...this.snapshot, folderId })
  }

  async submit(): Promise<void> {
    if (this.snapshot.phase !== "ready" || !this.adapter) return
    const title = this.snapshot.title.trim()
    if (!title) {
      this.publish({
        ...this.snapshot,
        message: "Enter a title before saving.",
      })
      return
    }

    const submitting = { ...this.snapshot, phase: "submitting" as const }
    this.publish(submitting)
    try {
      await this.adapter.bookmarks.create({
        parentId: submitting.folderId,
        title,
        url: submitting.url,
      })
      const folderLabel =
        submitting.folders.find((folder) => folder.id === submitting.folderId)
          ?.label ?? "the selected folder"
      this.publish({
        ...submitting,
        phase: "success",
        title,
        message: `Saved to ${folderLabel} in ${submitting.sourceLabel}.`,
      })
    } catch (error) {
      this.publish({
        ...submitting,
        phase: "ready",
        message: errorMessage(error),
      })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.adapter?.bookmarks.dispose?.()
    this.adapter = null
    this.listeners.clear()
  }
}
