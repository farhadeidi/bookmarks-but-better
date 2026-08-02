// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "../types"
import { deriveBookmarkTitle, parseNetscapeBookmarks } from "./netscape-parser"

function wrap(body: string): string {
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${body}
</DL><p>`
}

function flatten(nodes: BookmarkNode[]): string[] {
  return nodes.flatMap((node) => [
    node.url ? `${node.title} -> ${node.url}` : `[${node.title}]`,
    ...flatten(node.children ?? []),
  ])
}

describe("parseNetscapeBookmarks", () => {
  it("parses a Chrome-shaped export, including nested folders", () => {
    const html =
      wrap(`    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://a.com" ADD_DATE="1700000002">A</A>
        <DT><H3>Sub</H3>
        <DL><p>
            <DT><A HREF="https://b.com">B</A>
        </DL><p>
        <DT><A HREF="https://c.com">C</A>
    </DL><p>
    <DT><H3>Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://d.com">D</A>
    </DL><p>`)

    expect(flatten(parseNetscapeBookmarks(html)[0].children ?? [])).toEqual([
      "[Bookmarks bar]",
      "A -> https://a.com",
      "[Sub]",
      "B -> https://b.com",
      "C -> https://c.com",
      "[Other bookmarks]",
      "D -> https://d.com",
    ])
  })

  it("gives an untitled bookmark a title derived from its host", () => {
    const html = wrap(`    <DT><A HREF="https://news.example.com/path"></A>`)

    const [bookmark] = parseNetscapeBookmarks(html)[0].children ?? []
    expect(bookmark.title).toBe("news.example.com")
  })

  it("gives an untitled folder a placeholder title", () => {
    const html = wrap(`    <DT><H3></H3>
    <DL><p>
        <DT><A HREF="https://a.com">A</A>
    </DL><p>`)

    const [folder] = parseNetscapeBookmarks(html)[0].children ?? []
    expect(folder.title).toBe("Untitled Folder")
  })

  it("drops anchors with no usable HREF instead of emitting an empty url", () => {
    const html = wrap(`    <DT><A>Broken</A>
    <DT><A HREF="">Also broken</A>
    <DT><A HREF="https://ok.com">Fine</A>`)

    expect(flatten(parseNetscapeBookmarks(html)[0].children ?? [])).toEqual([
      "Fine -> https://ok.com",
    ])
  })

  it("ignores separators", () => {
    const html = wrap(`    <DT><A HREF="https://a.com">A</A>
    <HR>
    <DT><A HREF="https://b.com">B</A>`)

    expect(parseNetscapeBookmarks(html)[0].children).toHaveLength(2)
  })

  it("returns an empty tree for a file with no list at all", () => {
    expect(parseNetscapeBookmarks("<html><body>nope</body></html>")).toEqual([])
  })
})

describe("deriveBookmarkTitle", () => {
  it("keeps a real title", () => {
    expect(deriveBookmarkTitle("  Hello  ", "https://a.com")).toBe("Hello")
  })

  it("falls back to the host", () => {
    expect(deriveBookmarkTitle("", "https://a.com/x")).toBe("a.com")
  })

  it("falls back to the raw value for a hostless URL", () => {
    expect(deriveBookmarkTitle("", "javascript:alert(1)")).toBe(
      "javascript:alert(1)"
    )
  })

  it("falls back to a placeholder when there is nothing to work with", () => {
    expect(deriveBookmarkTitle("", "  ")).toBe("Untitled")
  })
})
