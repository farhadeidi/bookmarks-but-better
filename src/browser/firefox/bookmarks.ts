import type { BookmarkAdapter, BookmarkNode } from "../types"

function toBookmarkNode(node: chrome.bookmarks.BookmarkTreeNode): BookmarkNode {
  return {
    id: node.id,
    title: node.title,
    url: node.url,
    parentId: node.parentId,
    dateAdded: node.dateAdded,
    children: node.children?.map(toBookmarkNode),
  }
}

export class FirefoxBookmarkAdapter implements BookmarkAdapter {
  async getTree(): Promise<BookmarkNode[]> {
    const tree = await chrome.bookmarks.getTree()
    return tree.map(toBookmarkNode)
  }

  async getSubTree(id: string): Promise<BookmarkNode[]> {
    const tree = await chrome.bookmarks.getSubTree(id)
    return tree.map(toBookmarkNode)
  }

  async create(bookmark: {
    parentId: string
    title: string
    url?: string
  }): Promise<BookmarkNode> {
    const node = await chrome.bookmarks.create(bookmark)
    return toBookmarkNode(node)
  }

  async update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode> {
    const node = await chrome.bookmarks.update(id, changes)
    return toBookmarkNode(node)
  }

  async remove(id: string): Promise<void> {
    await chrome.bookmarks.remove(id)
  }

  async removeTree(id: string): Promise<void> {
    await chrome.bookmarks.removeTree(id)
  }

  async move(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void> {
    const [node] = await chrome.bookmarks.get(id)
    const targetParentId = destination.parentId ?? node.parentId

    let index = destination.index
    if (
      node.parentId === targetParentId &&
      node.index != null &&
      node.index < index
    ) {
      index += 1
    }

    await chrome.bookmarks.move(id, { ...destination, index })
  }

  onChanged(callback: () => void): () => void {
    chrome.bookmarks.onChanged.addListener(callback)
    return () => chrome.bookmarks.onChanged.removeListener(callback)
  }

  onCreated(callback: () => void): () => void {
    chrome.bookmarks.onCreated.addListener(callback)
    return () => chrome.bookmarks.onCreated.removeListener(callback)
  }

  onRemoved(callback: () => void): () => void {
    chrome.bookmarks.onRemoved.addListener(callback)
    return () => chrome.bookmarks.onRemoved.removeListener(callback)
  }

  onMoved(callback: () => void): () => void {
    chrome.bookmarks.onMoved.addListener(callback)
    return () => chrome.bookmarks.onMoved.removeListener(callback)
  }

  // Firefox has no equivalent to chrome://bookmarks — no-op.
  // The UI hides this button when capabilities.openInManager is false.
  async openInManager(): Promise<void> {
    // intentional no-op
  }
}
