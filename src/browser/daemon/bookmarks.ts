import type { AdapterHealth, BookmarkAdapter, BookmarkNode } from "../types"
import type { DaemonClient, DaemonNodeKind, OrderChild } from "./client"
import { connectDaemonEvents } from "./sse"

/**
 * Deliberately holds no `stateRevision`: a folder's order revision is
 * invalidated by changes to *other* nodes — `move()` rewrites the destination
 * parent's order file — so a cached copy would go stale without anything here
 * knowing. `setChildOrder` reads it from a fresh DTO instead (read-before-write),
 * which is the only way to get one that is safe to send.
 */
interface NodeMeta {
  kind: DaemonNodeKind
  revision?: string
}

/**
 * A directory the vault can see but cannot name: no `.bookmarks-but-better-folder.md`, so the
 * daemon serves it under a synthetic `!path` id. It has no identity an order
 * file could record, so it is excluded from every child order — the daemon
 * refuses a payload that mentions one (400) just as firmly as one that counts
 * it (422). Such directories always trail the folder and never move.
 */
function isAddressable(node: BookmarkNode): boolean {
  return !node.id.startsWith("!")
}

function kindOf(node: BookmarkNode): DaemonNodeKind {
  return node.url !== undefined ? "bookmark" : "folder"
}

export interface DaemonBookmarkAdapterOptions {
  /** The configured connection. Same-origin for the served UI, absolute loopback for an extension. */
  client: DaemonClient
  /** Test-only seam: replaces how the change stream is opened. */
  connectEvents?: typeof connectDaemonEvents
}

/**
 * Talks to the daemon's /api/v1 HTTP contract and mirrors the same
 * local-listener pattern the standalone (IndexedDB) adapter uses: every
 * successful mutation notifies its own listeners immediately, so the UI
 * refreshes without waiting on the SSE `changed` event. SSE still drives
 * refreshes for changes made outside this tab (another tab, an external
 * editor, a CLI rescan).
 *
 * GET, PATCH, and move all address a node through the single /bookmarks/:id
 * path regardless of whether it's a bookmark or a folder; DELETE keeps
 * separate /bookmarks/:id and /folders/:id routes, since removing a folder
 * needs `recursive=true`. Revision and bookmark-vs-folder kind aren't part
 * of the shared `BookmarkAdapter` interface, so they're cached here, keyed
 * by id, from every tree/subtree response and every mutation response.
 * `getTree()` rebuilds the cache from scratch (single source of truth for a
 * full refresh); `getSubTree()` merges in, since it's used for lazy
 * per-folder loads and must not evict sibling entries.
 */
export class DaemonBookmarkAdapter implements BookmarkAdapter {
  private nodeMeta = new Map<string, NodeMeta>()
  private listeners = {
    changed: new Set<() => void>(),
    created: new Set<() => void>(),
    removed: new Set<() => void>(),
    moved: new Set<() => void>(),
  }
  private readonly client: DaemonClient
  private readonly disconnectEvents: () => void

  constructor(options: DaemonBookmarkAdapterOptions) {
    this.client = options.client
    const connect = options.connectEvents ?? connectDaemonEvents
    // The stream is opened against the *same* client the requests use, so an
    // extension pointed at a custom port streams from that port and sends the
    // same credentials — there is no second place to configure.
    this.disconnectEvents = connect({
      url: this.client.eventsUrl,
      headers: this.client.authHeaders(),
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

  async checkHealth(): Promise<AdapterHealth> {
    const health = await this.client.fetchHealth()
    return { ready: health.status === "ok", warnings: health.warnings }
  }

  async getTree(): Promise<BookmarkNode[]> {
    const { tree } = await this.client.fetchTree()
    this.nodeMeta.clear()
    this.indexNodes(tree)
    return tree
  }

  async getSubTree(id: string): Promise<BookmarkNode[]> {
    const node = await this.client.fetchNode(id)
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
    const node = await this.client.createNode(kind, bookmark)
    this.nodeMeta.set(node.id, { kind, revision: node.revision })
    this.notify("created")
    return node
  }

  async update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode> {
    const meta = this.meta(id)
    const node = await this.client.updateNode(id, {
      revision: meta.revision!,
      ...changes,
    })
    this.nodeMeta.set(id, { kind: meta.kind, revision: node.revision })
    this.notify("changed")
    return node
  }

  async remove(id: string): Promise<void> {
    const meta = this.meta(id)
    await this.client.deleteNode(meta.kind, id, meta.revision!)
    this.nodeMeta.delete(id)
    this.notify("removed")
  }

  async removeTree(id: string): Promise<void> {
    const meta = this.meta(id)
    await this.client.deleteNode(meta.kind, id, meta.revision!, {
      recursive: true,
    })
    this.nodeMeta.delete(id)
    this.notify("removed")
  }

  async move(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void> {
    // `move()` is the *shared* adapter contract, so it stays index-less here:
    // the daemon's move endpoint can take a position, but honouring it would
    // change what a cross-folder grid drag does in daemon mode and would make
    // every caller responsible for order-file revisions it has no way to
    // obtain. Positional changes travel on `setChildOrder()` instead, and
    // `capabilities.reorder` stays false so nothing routes ordering through
    // here. A same-parent "reorder" is therefore still nothing to send.
    if (!destination.parentId) return

    const meta = this.meta(id)
    const node = await this.client.moveNode(id, {
      revision: meta.revision!,
      parentId: destination.parentId,
    })
    if (node) {
      this.nodeMeta.set(id, { kind: meta.kind, revision: node.revision })
    }
    this.notify("moved")
  }

  /**
   * Replaces a folder's whole child order in one atomic request.
   *
   * Read-before-write, deliberately: kinds, addressability, duplicate ids and
   * the order file's revision are all server truth, and the caller's list can
   * be an arbitrarily stale UI snapshot. Re-reading the folder is what makes
   * the PUT a valid permutation instead of a guess.
   *
   * `orderReadOnly` is *not* pre-checked here. The daemon is the authority on
   * a frozen order; the flag exists to disable the affordance, not to
   * simulate the refusal.
   */
  async setChildOrder(
    folderId: string,
    orderedChildIds: string[]
  ): Promise<void> {
    // `getSubTree` either throws (a daemon problem response) or yields the
    // folder, so there is no third "read succeeded but produced nothing" case
    // to defend against here.
    const [folder] = await this.getSubTree(folderId)

    // A damaged vault can serve one id twice (the daemon dedupes it for
    // ordering purposes but still lists both), and the order contract wants
    // every child exactly once — so the first occurrence wins on both sides.
    const addressable = new Map<string, BookmarkNode>()
    for (const child of folder.children ?? []) {
      if (!isAddressable(child)) continue
      if (!addressable.has(child.id)) addressable.set(child.id, child)
    }

    const serverOrder = [...addressable.keys()]
    const requested: string[] = []
    const placed = new Set<string>()
    for (const id of orderedChildIds) {
      if (!addressable.has(id) || placed.has(id)) continue
      placed.add(id)
      requested.push(id)
    }
    // Anything the caller didn't name keeps its server-side relative order at
    // the end; a permutation that omits a child is refused, not completed.
    for (const id of serverOrder) {
      if (placed.has(id)) continue
      placed.add(id)
      requested.push(id)
    }

    if (requested.every((id, index) => serverOrder[index] === id)) {
      // Already in this order. The daemon would write zero bytes; skipping
      // also avoids a pointless notify/refresh cycle.
      return
    }

    const children: OrderChild[] = requested.map((id) => ({
      id,
      kind: kindOf(addressable.get(id)!),
    }))
    const updated = await this.client.setOrder(folderId, {
      // Omitted entirely — not sent as null — when the folder has no order
      // file: absence is the claim the daemon checks against.
      ...(folder.stateRevision !== undefined
        ? { stateRevision: folder.stateRevision }
        : {}),
      children,
    })

    this.indexNodes([updated])
    this.notify("changed")
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
