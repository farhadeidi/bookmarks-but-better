import type { AdapterMode, BrowserAdapter } from "@/browser/types"
import { detectAdapter } from "@/browser"
import { getAdapterModePreference } from "@/browser/adapter-preference"
import {
  buildRootFolderOptions,
  resolveCreateParentId,
  type RootFolderOption,
} from "@/features/root-folder-select"

export interface ActiveTab {
  title?: string
  url?: string
}

export interface CaptureSelection {
  adapter: BrowserAdapter
  mode: AdapterMode
}

export interface CaptureControllerDependencies {
  getActiveTab(): Promise<ActiveTab | null>
  selectAdapter(): Promise<CaptureSelection>
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
  sourceLabel: string
  message: string | null
}

const INITIAL_SNAPSHOT: CaptureSnapshot = {
  phase: "loading",
  title: "",
  url: "",
  folders: [],
  folderId: "",
  sourceLabel: "",
  message: null,
}

const SOURCE_LABELS: Record<AdapterMode, string> = {
  browser: "Browser bookmarks",
  daemon: "Local daemon",
  standalone: "Standalone bookmarks",
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

export async function selectCurrentAdapter(): Promise<CaptureSelection> {
  const mode = (await getAdapterModePreference()) ?? "browser"
  const adapter = await detectAdapter()
  return { adapter, mode }
}

export async function getCurrentTab(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ? { title: tab.title, url: tab.url } : null
}

export function createCaptureDependencies(): CaptureControllerDependencies {
  return {
    getActiveTab: getCurrentTab,
    selectAdapter: selectCurrentAdapter,
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
        selection.adapter.bookmarks.dispose?.()
        return
      }
      this.adapter = selection.adapter

      if (selection.adapter.bookmarks.checkHealth) {
        const health = await selection.adapter.bookmarks.checkHealth()
        if (!health.ready) {
          throw new Error("The selected bookmark source is not ready.")
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
        sourceLabel: SOURCE_LABELS[selection.mode],
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
        message: `Saved to ${folderLabel}.`,
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
