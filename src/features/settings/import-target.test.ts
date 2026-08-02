import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import { resolveDefaultImportParentId } from "./import-target"

const BROWSER_TREE: BookmarkNode[] = [
  {
    id: "0",
    title: "",
    children: [
      { id: "1", title: "Bookmarks Bar", children: [] },
      { id: "2", title: "Other Bookmarks", children: [] },
    ],
  },
]

const VAULT_TREE: BookmarkNode[] = [
  { id: "vault", title: "Bookmarks", children: [] },
]

describe("resolveDefaultImportParentId", () => {
  it("prefers the selected dashboard root", () => {
    expect(resolveDefaultImportParentId(BROWSER_TREE, "2", false)).toBe("2")
  })

  it("falls back to the Bookmarks Bar in browser mode, never the synthetic root", () => {
    expect(resolveDefaultImportParentId(BROWSER_TREE, null, false)).toBe("1")
  })

  it("falls back to the vault root in daemon and standalone mode", () => {
    expect(resolveDefaultImportParentId(VAULT_TREE, null, true)).toBe("vault")
  })

  it("returns null only when there is genuinely nowhere to write", () => {
    expect(resolveDefaultImportParentId([], null, false)).toBeNull()
  })
})
