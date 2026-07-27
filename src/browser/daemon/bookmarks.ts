import type { BookmarkAdapter, BookmarkNode } from "../types"
import {
  createNode,
  deleteNode,
  fetchSubTree,
  fetchTree,
  moveNode,
  updateNode,
  type DaemonNodeKind,
} from "./client"
import { connectDaemonEvents } from "./sse"

interface NodeMeta {
  kind: DaemonNodeKind
  revision?: string
}

function kindOf(node: BookmarkNode): DaemonNodeKind {
  return node.url !== undefined ? "bookmark" : "folder"
}

/**
 * Talks to the daemon's fixed /api/v1 HTTP contract and mirrors the same
 * local-listener pattern the standalone (IndexedDB) adapter uses: every
 * successful mutation notifies its own listeners immediately, so the UI
 * refreshes without waiting on the SSE `changed` event. SSE still drives
 * refreshes for changes made outside this tab (another tab, an external
 * editor, a CLI rescan).
 *
 * Revisions and bookmark-vs-folder kind aren't part of the shared
 * `BookmarkAdapter` interface, so they're cached here, keyed by id, from
 * every tree/subtree response and every mutation response. `getTree()`
 * rebuilds the cache from scratch (single source of truth for a full
 * refresh); `getSubTree()` merges in, since it's used for lazy per-folder
 * loads and must not evict sibling entries.
 */
export class DaemonBookmarkAdapter implements BookmarkAdapter {
  private nodeMeta = new Map<string, NodeMeta>()
  private listeners = {
    changed: new Set<() => void>(),
    created: new Set<() => void>(),
    removed: new Set<() => void>(),
    moved: new Set<() => void>(),
  }
  private readonly disconnectEvents: () => void

  constructor() {
    this.disconnectEvents = connectDaemonEvents({
      onChanged: () => this.notify("changed"),
    })
  }

  private notify(event: "changed" | "created" | "removed" | "moved") {
    for (const cb of this.listeners[event]) cb()
  }

  private indexNodes(nodes: BookmarkNode[]) {
    const visit = (node: BookmarkNode) => {
      this.nodeMeta.set(node.id, {
        kind: kindOf(node),
        revision: node.revision,
      })
      node.children?.forEach(visit)
    }
    nodes.forEach(visit)
  }

  private meta(id: string): NodeMeta {
    const meta = this.nodeMeta.get(id)
    if (!meta) {
      throw new Error(`Unknown node: ${id}`)
    }
    if (!meta.revision) {
      throw new Error(`Missing revision for node: ${id}`)
    }
    return meta
  }

  async getTree(): Promise<BookmarkNode[]> {
    const { root } = await fetchTree()
    this.nodeMeta.clear()
    this.indexNodes([root])
    return [root]
  }

  async getSubTree(id: string): Promise<BookmarkNode[]> {
    const { node } = await fetchSubTree(id)
    this.indexNodes([node])
    return [node]
  }

  async create(bookmark: {
    parentId: string
    title: string
    url?: string
  }): Promise<BookmarkNode> {
    const kind: DaemonNodeKind =
      bookmark.url !== undefined ? "bookmark" : "folder"
    const node = await createNode(kind, bookmark)
    this.nodeMeta.set(node.id, { kind, revision: node.revision })
    this.notify("created")
    return node
  }

  async update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode> {
    const meta = this.meta(id)
    const node = await updateNode(meta.kind, id, {
      revision: meta.revision!,
      ...changes,
    })
    this.nodeMeta.set(id, { kind: meta.kind, revision: node.revision })
    this.notify("changed")
    return node
  }

  async remove(id: string): Promise<void> {
    const meta = this.meta(id)
    await deleteNode(meta.kind, id, meta.revision!)
    this.nodeMeta.delete(id)
    this.notify("removed")
  }

  async removeTree(id: string): Promise<void> {
    await this.remove(id)
  }

  async move(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void> {
    // Daemon sibling ordering is deterministic server-side (capabilities.reorder
    // is false), so there's no index to send — only cross-folder moves apply.
    if (!destination.parentId) return

    const meta = this.meta(id)
    const node = await moveNode(meta.kind, id, {
      revision: meta.revision!,
      parentId: destination.parentId,
    })
    if (node) {
      this.nodeMeta.set(id, { kind: meta.kind, revision: node.revision })
    }
    this.notify("moved")
  }

  onChanged(callback: () => void): () => void {
    this.listeners.changed.add(callback)
    return () => this.listeners.changed.delete(callback)
  }

  onCreated(callback: () => void): () => void {
    this.listeners.created.add(callback)
    return () => this.listeners.created.delete(callback)
  }

  onRemoved(callback: () => void): () => void {
    this.listeners.removed.add(callback)
    return () => this.listeners.removed.delete(callback)
  }

  onMoved(callback: () => void): () => void {
    this.listeners.moved.add(callback)
    return () => this.listeners.moved.delete(callback)
  }

  async openInManager(): Promise<void> {
    // No-op: the daemon has no separate bookmark-manager UI to deep-link to.
  }

  dispose(): void {
    this.disconnectEvents()
  }
}
