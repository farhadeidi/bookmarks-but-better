import type { BookmarkAdapter, BookmarkNode } from "../types"

const DB_NAME = "bookmarks-but-better"
const DB_VERSION = 1
const STORE_NAME = "bookmarks"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("parentId", "parentId", { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

interface StoredBookmark {
  id: string
  title: string
  url?: string
  parentId?: string
  dateAdded: number
  index?: number
}

function generateId(): string {
  return crypto.randomUUID()
}

async function getAllBookmarks(db: IDBDatabase): Promise<StoredBookmark[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function buildTree(bookmarks: StoredBookmark[]): BookmarkNode[] {
  const indexMap = new Map(bookmarks.map((b) => [b.id, b.index ?? 0]))
  const map = new Map<string, BookmarkNode>()
  const roots: BookmarkNode[] = []

  for (const b of bookmarks) {
    map.set(b.id, {
      id: b.id,
      title: b.title,
      url: b.url,
      parentId: b.parentId,
      dateAdded: b.dateAdded,
      children: [],
    })
  }

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node)
    } else if (!node.parentId) {
      roots.push(node)
    }
  }

  // Sort children by index
  for (const node of map.values()) {
    if (node.children && node.children.length > 1) {
      node.children.sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0))
    }
  }
  roots.sort((a, b) => (indexMap.get(a.id) ?? 0) - (indexMap.get(b.id) ?? 0))

  return roots
}

async function putBookmark(
  db: IDBDatabase,
  bookmark: StoredBookmark
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(bookmark)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function deleteBookmark(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function getChildIds(db: IDBDatabase, id: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const index = store.index("parentId")
    const request = index.getAll(id)
    request.onsuccess = () => {
      const children = request.result as StoredBookmark[]
      resolve(children.map((c) => c.id))
    }
    request.onerror = () => reject(request.error)
  })
}

async function deleteTreeRecursive(
  db: IDBDatabase,
  id: string
): Promise<void> {
  const childIds = await getChildIds(db, id)
  for (const childId of childIds) {
    await deleteTreeRecursive(db, childId)
  }
  await deleteBookmark(db, id)
}

export class StandaloneBookmarkAdapter implements BookmarkAdapter {
  private db: IDBDatabase | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB()
    }
    return this.db
  }

  async getTree(): Promise<BookmarkNode[]> {
    const db = await this.getDB()
    const all = await getAllBookmarks(db)

    if (all.length === 0) {
      await this.seedFromDevData(db)
      const seeded = await getAllBookmarks(db)
      return buildTree(seeded)
    }

    return buildTree(all)
  }

  private async seedFromDevData(db: IDBDatabase): Promise<void> {
    function flattenNodes(
      nodes: BookmarkNode[],
      result: StoredBookmark[] = []
    ): StoredBookmark[] {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        result.push({
          id: node.id,
          title: node.title,
          url: node.url,
          parentId: node.parentId,
          dateAdded: node.dateAdded ?? Date.now(),
          index: i,
        })
        if (node.children) {
          flattenNodes(node.children, result)
        }
      }
      return result
    }

    const { default: seedData } = await import("@/dev/seed-bookmarks.json")
    const flat = flattenNodes(seedData as BookmarkNode[])
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    for (const bookmark of flat) {
      store.put(bookmark)
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getSubTree(id: string): Promise<BookmarkNode[]> {
    const tree = await this.getTree()

    function findNode(nodes: BookmarkNode[]): BookmarkNode | null {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = findNode(node.children)
          if (found) return found
        }
      }
      return null
    }

    const node = findNode(tree)
    return node ? [node] : []
  }

  async create(bookmark: {
    parentId: string
    title: string
    url?: string
  }): Promise<BookmarkNode> {
    const db = await this.getDB()
    const all = await getAllBookmarks(db)
    const siblingCount = all.filter((b) => b.parentId === bookmark.parentId).length
    const stored: StoredBookmark = {
      id: generateId(),
      title: bookmark.title,
      url: bookmark.url,
      parentId: bookmark.parentId,
      dateAdded: Date.now(),
      index: siblingCount,
    }
    await putBookmark(db, stored)
    return {
      id: stored.id,
      title: stored.title,
      url: stored.url,
      parentId: stored.parentId,
      dateAdded: stored.dateAdded,
      children: [],
    }
  }

  async update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode> {
    const db = await this.getDB()
    const all = await getAllBookmarks(db)
    const existing = all.find((b) => b.id === id)
    if (!existing) {
      throw new Error(`Bookmark not found: ${id}`)
    }
    const updated: StoredBookmark = {
      ...existing,
      ...(changes.title !== undefined && { title: changes.title }),
      ...(changes.url !== undefined && { url: changes.url }),
    }
    await putBookmark(db, updated)
    return {
      id: updated.id,
      title: updated.title,
      url: updated.url,
      parentId: updated.parentId,
      dateAdded: updated.dateAdded,
      children: [],
    }
  }

  async remove(id: string): Promise<void> {
    const db = await this.getDB()
    await deleteBookmark(db, id)
  }

  async removeTree(id: string): Promise<void> {
    const db = await this.getDB()
    await deleteTreeRecursive(db, id)
  }

  async move(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void> {
    const db = await this.getDB()
    const all = await getAllBookmarks(db)
    const bookmark = all.find((b) => b.id === id)
    if (!bookmark) throw new Error(`Bookmark not found: ${id}`)

    const oldParentId = bookmark.parentId
    const newParentId = destination.parentId ?? oldParentId
    const newIndex = destination.index

    // Remove from old parent and re-index siblings
    const oldSiblings = all
      .filter((b) => b.parentId === oldParentId && b.id !== id)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    for (let i = 0; i < oldSiblings.length; i++) {
      if (oldSiblings[i].index !== i) {
        oldSiblings[i].index = i
        await putBookmark(db, oldSiblings[i])
      }
    }

    // Get new parent's children (excluding moved item)
    const newSiblings =
      oldParentId === newParentId
        ? oldSiblings
        : all
            .filter((b) => b.parentId === newParentId && b.id !== id)
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

    // Shift siblings at and after the insertion point
    const clampedIndex = Math.min(newIndex, newSiblings.length)
    for (let i = newSiblings.length - 1; i >= clampedIndex; i--) {
      newSiblings[i].index = i + 1
      await putBookmark(db, newSiblings[i])
    }

    // Update the moved bookmark
    bookmark.parentId = newParentId
    bookmark.index = clampedIndex
    await putBookmark(db, bookmark)
  }

  // Standalone mode: no external events. The store calls refresh() after mutations.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onChanged(_callback: () => void): () => void {
    return () => {}
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onCreated(_callback: () => void): () => void {
    return () => {}
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onRemoved(_callback: () => void): () => void {
    return () => {}
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onMoved(_callback: () => void): () => void {
    return () => {}
  }

  async openInManager(): Promise<void> {
    // No-op in standalone mode — no Chrome bookmarks manager available
  }
}
