import type { BookmarkNode } from "../types"

/**
 * Parses the standard Netscape Bookmark HTML format exported by browsers.
 * Structure: nested <DL> lists with <DT> entries for folders and links.
 */
export function parseNetscapeBookmarks(html: string): BookmarkNode[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const rootDL = doc.querySelector("DL")

  if (!rootDL) {
    return []
  }

  let idCounter = 1

  function generateId(): string {
    return String(idCounter++)
  }

  function parseDL(
    dl: Element,
    parentId?: string
  ): BookmarkNode[] {
    const nodes: BookmarkNode[] = []
    const children = Array.from(dl.children)

    for (let i = 0; i < children.length; i++) {
      const child = children[i]

      if (child.tagName !== "DT") continue

      const anchor = child.querySelector(":scope > A")
      const heading = child.querySelector(":scope > H3")

      if (anchor) {
        // It's a bookmark link
        const id = generateId()
        nodes.push({
          id,
          title: anchor.textContent?.trim() ?? "",
          url: anchor.getAttribute("HREF") ?? "",
          parentId,
          dateAdded: parseAddDate(anchor.getAttribute("ADD_DATE")),
          children: undefined,
        })
      } else if (heading) {
        // It's a folder — the next sibling should be a <DL>
        const id = generateId()
        const nextSibling = children[i + 1]
        const nestedDL =
          nextSibling?.tagName === "DL"
            ? nextSibling
            : child.querySelector(":scope > DL")

        const folderChildren = nestedDL ? parseDL(nestedDL, id) : []

        nodes.push({
          id,
          title: heading.textContent?.trim() ?? "",
          parentId,
          dateAdded: parseAddDate(heading.getAttribute("ADD_DATE")),
          children: folderChildren,
        })

        // Skip the DL we just consumed
        if (nextSibling?.tagName === "DL") {
          i++
        }
      }
    }

    return nodes
  }

  function parseAddDate(value: string | null): number | undefined {
    if (!value) return undefined
    const timestamp = parseInt(value, 10)
    if (isNaN(timestamp)) return undefined
    // Netscape format uses seconds since epoch
    return timestamp * 1000
  }

  const rootId = "0"
  const rootChildren = parseDL(rootDL, rootId)

  return [
    {
      id: rootId,
      title: "",
      children: rootChildren,
    },
  ]
}
