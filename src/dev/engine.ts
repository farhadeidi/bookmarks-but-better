/**
 * The dev engine: one mutable, persisted bookmark tree per simulated source.
 *
 * This is *not* the deprecated Standalone adapter. It exists so the Dev
 * Workbench can exercise every application operation — CRUD, move/reorder,
 * whole-folder ordering, change events, source-scoped storage — against the
 * same `BrowserAdapter` surface production uses, with capabilities that
 * honestly describe which source is being simulated (a browser source orders
 * through `move(id, {index})`; a daemon Vault orders through
 * `setChildOrder` and appends on cross-folder moves).
 *
 * Determinism: a tree that has never been persisted is seeded from the
 * scenario's pure seed data; wiping the store restores exactly that seed.
 */

import type { BookmarkNode } from "@/browser"
import type { SeedNode } from "./scenarios"
import {
  currentSourceEpoch,
  devGet,
  devPutUnlessSealed,
  SOURCES_STORE,
} from "./state"

export type EngineFlavor = "browser" | "standalone" | "daemon"

export type EngineEvent = "changed" | "created" | "removed" | "moved"

export interface MutableEngineOptions {
  /** Persistence key; one per simulated source. */
  sourceKey: string
  flavor: EngineFlavor
  /** Builds the root node the very first time this source is hydrated. */
  seed(): BookmarkNode
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)
}

function isFolder(node: BookmarkNode): boolean {
  return node.children !== undefined
}

function visit(node: BookmarkNode, fn: (node: BookmarkNode) => void): void {
  fn(node)
  for (const child of node.children ?? []) visit(child, fn)
}

function findNode(root: BookmarkNode, id: string): BookmarkNode | null {
  if (root.id === id) return root
  for (const child of root.children ?? []) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function findParent(root: BookmarkNode, id: string): BookmarkNode | null {
  for (const child of root.children ?? []) {
    if (child.id === id) return root
    const found = findParent(child, id)
    if (found) return found
  }
  return null
}

function contains(node: BookmarkNode, id: string): boolean {
  if (node.id === id) return true
  return (node.children ?? []).some((child) => contains(child, id))
}

function detachFrom(parent: BookmarkNode, id: string): BookmarkNode | null {
  if (!parent.children) return null
  const index = parent.children.findIndex((child) => child.id === id)
  if (index < 0) return null
  const [removed] = parent.children.splice(index, 1)
  return removed ?? null
}

/**
 * Turns a seed tree into real nodes with deterministic ids: a fixed prefix
 * plus a per-seed counter, so the same scenario always produces the same
 * tree, ids included.
 */
export function materializeSeed(
  rootId: string,
  rootTitle: string,
  prefix: string,
  children: SeedNode[],
  folderIds: Array<{ id: string; title: string; children?: SeedNode[] }> = []
): BookmarkNode {
  let counter = 0
  const base = 1_700_000_000_000
  const build = (seed: SeedNode): BookmarkNode => {
    const id = `${prefix}${++counter}`
    const node: BookmarkNode = {
      id,
      title: seed.title,
      dateAdded: base + counter * 1_000,
    }
    if (seed.url !== undefined) {
      node.url = seed.url
    } else {
      node.children = (seed.children ?? []).map(build)
    }
    return node
  }

  const root: BookmarkNode = { id: rootId, title: rootTitle, children: [] }
  // Fixed structural children (the browser's Bar/Other roots) keep their
  // well-known ids; everything else takes generated ones.
  for (const structural of folderIds) {
    const node: BookmarkNode = {
      id: structural.id,
      title: structural.title,
      children: (structural.children ?? []).map(build),
    }
    root.children!.push(node)
  }
  for (const seed of children) {
    root.children!.push(build(seed))
  }
  return root
}

export class MutableBookmarkEngine {
  private root: BookmarkNode | null = null
  private hydration: Promise<void> | null = null
  private idCounter = 0
  private readonly sourceKey: string
  private readonly flavor: EngineFlavor
  private readonly seedFn: () => BookmarkNode
  /**
   * The scenario epoch this engine's world belongs to. A reset seals the
   * epoch it was created under, and this tree — in memory and in any write
   * still in flight — belongs to the wiped world from then on.
   */
  private readonly epoch: number
  private readonly listeners: Record<EngineEvent, Set<() => void>> = {
    changed: new Set(),
    created: new Set(),
    removed: new Set(),
    moved: new Set(),
  }

  constructor(options: MutableEngineOptions) {
    this.sourceKey = options.sourceKey
    this.flavor = options.flavor
    this.seedFn = options.seed
    this.epoch = currentSourceEpoch()
  }

  /** Which kind of source this engine simulates. */
  get simulatedFlavor(): EngineFlavor {
    return this.flavor
  }

  /** Hydrates from the dev store, seeding deterministically when absent. */
  ready(): Promise<void> {
    this.hydration ??= (async () => {
      const stored = await devGet<BookmarkNode>(
        SOURCES_STORE,
        `tree:${this.sourceKey}`
      )
      this.root = stored ?? this.seedFn()
      visit(this.root, (node) => {
        const match = /(\d+)$/.exec(node.id)
        if (match) this.idCounter = Math.max(this.idCounter, Number(match[1]))
      })
      if (!stored) await this.persist()
    })()
    return this.hydration
  }

  private assertRoot(): BookmarkNode {
    if (!this.root) throw new Error("Engine not hydrated")
    return this.root
  }

  private async persist(): Promise<void> {
    if (this.root) {
      // Sealed-drop, not a plain write: a persist settling after a reset's
      // wipe must not resurrect the tree of the wiped world.
      await devPutUnlessSealed(
        SOURCES_STORE,
        `tree:${this.sourceKey}`,
        this.root,
        this.epoch
      )
    }
  }

  private nextId(): string {
    return `dev-${this.flavor}-${++this.idCounter}`
  }

  subscribe(event: EngineEvent, callback: () => void): () => void {
    this.listeners[event].add(callback)
    return () => this.listeners[event].delete(callback)
  }

  private notify(event: EngineEvent): void {
    for (const callback of this.listeners[event]) callback()
  }

  /** Drops every listener; the persisted tree survives for the next session. */
  dispose(): void {
    for (const set of Object.values(this.listeners)) set.clear()
  }

  async getTree(): Promise<BookmarkNode[]> {
    await this.ready()
    return [clone(this.assertRoot())]
  }

  async getSubTree(id: string): Promise<BookmarkNode[]> {
    await this.ready()
    const node = findNode(this.assertRoot(), id)
    if (!node) throw new Error(`Unknown node: ${id}`)
    return [clone(node)]
  }

  async create(bookmark: {
    parentId: string
    title: string
    url?: string
  }): Promise<BookmarkNode> {
    await this.ready()
    const root = this.assertRoot()
    const parent = findNode(root, bookmark.parentId)
    if (!parent) throw new Error(`Unknown parent: ${bookmark.parentId}`)
    if (!isFolder(parent)) throw new Error("Cannot create inside a bookmark")

    const node: BookmarkNode = {
      id: this.nextId(),
      title: bookmark.title,
      dateAdded: Date.now(),
    }
    if (bookmark.url !== undefined) {
      node.url = bookmark.url
    } else {
      node.children = []
    }
    parent.children!.push(node)
    await this.persist()
    this.notify("created")
    return clone(node)
  }

  async update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode> {
    await this.ready()
    const node = findNode(this.assertRoot(), id)
    if (!node) throw new Error(`Unknown node: ${id}`)
    if (changes.title !== undefined) node.title = changes.title
    if (changes.url !== undefined) node.url = changes.url
    await this.persist()
    this.notify("changed")
    return clone(node)
  }

  async remove(id: string): Promise<void> {
    await this.ready()
    const root = this.assertRoot()
    if (root.id === id) throw new Error("Cannot remove the root")
    const parent = findParent(root, id)
    if (!parent) throw new Error(`Unknown node: ${id}`)
    const node = findNode(root, id)!
    if (isFolder(node) && node.children!.length > 0) {
      throw new Error("Cannot remove a non-empty folder")
    }
    detachFrom(parent, id)
    await this.persist()
    this.notify("removed")
  }

  async removeTree(id: string): Promise<void> {
    await this.ready()
    const root = this.assertRoot()
    if (root.id === id) throw new Error("Cannot remove the root")
    const parent = findParent(root, id)
    if (!parent) throw new Error(`Unknown node: ${id}`)
    detachFrom(parent, id)
    await this.persist()
    this.notify("removed")
  }

  async move(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void> {
    await this.ready()
    const root = this.assertRoot()
    if (root.id === id) throw new Error("Cannot move the root")
    const node = findNode(root, id)
    if (!node) throw new Error(`Unknown node: ${id}`)
    const targetParent =
      destination.parentId !== undefined
        ? findNode(root, destination.parentId)
        : (findParent(root, id) ?? root)
    if (!targetParent)
      throw new Error(`Unknown parent: ${destination.parentId}`)
    if (!isFolder(targetParent))
      throw new Error("Cannot move inside a bookmark")
    if (contains(node, targetParent.id)) {
      throw new Error("Cannot move a folder into itself")
    }

    const oldParent = findParent(root, id)
    if (oldParent) detachFrom(oldParent, id)
    // A daemon's move endpoint has no notion of an index: cross-folder moves
    // land at the end, and ordering is a separate, whole-folder operation.
    const index =
      this.flavor === "daemon"
        ? targetParent.children!.length
        : Math.max(
            0,
            Math.min(destination.index, targetParent.children!.length)
          )
    targetParent.children!.splice(index, 0, node)
    await this.persist()
    this.notify("moved")
  }

  /**
   * Replaces a folder's whole child order, with the daemon's semantics: ids
   * the folder no longer holds are dropped, duplicates collapse to their
   * first occurrence, and unmentioned children keep their relative order at
   * the end.
   */
  async setChildOrder(
    folderId: string,
    orderedChildIds: string[]
  ): Promise<void> {
    await this.ready()
    const folder = findNode(this.assertRoot(), folderId)
    if (!folder) throw new Error(`Unknown node: ${folderId}`)
    if (!isFolder(folder)) throw new Error("Cannot order a bookmark")
    const children = folder.children!
    const byId = new Map(children.map((child) => [child.id, child]))
    const ordered: BookmarkNode[] = []
    const seen = new Set<string>()
    for (const id of orderedChildIds) {
      const child = byId.get(id)
      if (!child || seen.has(id)) continue
      seen.add(id)
      ordered.push(child)
    }
    for (const child of children) {
      if (!seen.has(child.id)) ordered.push(child)
    }
    folder.children = ordered
    await this.persist()
    this.notify("changed")
  }
}
