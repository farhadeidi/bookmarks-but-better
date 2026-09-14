import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "../types"
import { parseCsvBookmarks } from "./csv-parser"

function flatten(nodes: BookmarkNode[]): string[] {
  return nodes.flatMap((node) => [
    node.url ? `${node.title} -> ${node.url}` : `[${node.title}]`,
    ...flatten(node.children ?? []),
  ])
}

describe("parseCsvBookmarks", () => {
  it("parses a Raindrop export, nesting a folder path and keeping a quoted comma in the title", () => {
    const csv = [
      "title,note,excerpt,url,folder,tags,created",
      '"Hello, World",a note,an excerpt,https://example.com/a,Parent/Child,"tag1,tag2",2020-01-01T00:00:00Z',
      "Second,,,https://example.com/b,Parent,work,2020-01-02T00:00:00Z",
    ].join("\n")

    const { nodes, skipped } = parseCsvBookmarks(csv, "raindrop-export.csv")

    expect(flatten(nodes)).toEqual([
      "[Parent]",
      "[Child]",
      "Hello, World -> https://example.com/a",
      "Second -> https://example.com/b",
    ])
    expect(skipped).toBe(0)
  })

  it("puts every Pocket row in a single 'Pocket' folder", () => {
    const csv = [
      "title,url,time_added,tags,status",
      "My Item,https://example.com/b,1600000000,,unread",
      "Other Item,https://example.com/c,1600000001,news,archive",
    ].join("\n")

    const { nodes, skipped } = parseCsvBookmarks(csv, "pocket.csv")

    expect(flatten(nodes)).toEqual([
      "[Pocket]",
      "My Item -> https://example.com/b",
      "Other Item -> https://example.com/c",
    ])
    expect(skipped).toBe(0)
  })

  it("falls back to a single folder named after the file for an unrecognized header", () => {
    const csv = ["url,title", "https://example.com/d,Some page"].join("\n")

    const { nodes } = parseCsvBookmarks(csv, "my-export.csv")

    expect(flatten(nodes)).toEqual([
      "[my-export]",
      "Some page -> https://example.com/d",
    ])
  })

  it("tolerates a UTF-8 BOM at the start of the file", () => {
    const csv = "﻿" + ["url,title", "https://example.com/e,BOM test"].join("\n")

    const { nodes } = parseCsvBookmarks(csv, "with-bom.csv")

    expect(flatten(nodes)).toEqual([
      "[with-bom]",
      "BOM test -> https://example.com/e",
    ])
  })

  it("skips and counts rows without a valid http(s) URL", () => {
    const csv = [
      "title,url,time_added,tags,status",
      "No URL,,1600000000,,unread",
      "Bad scheme,javascript:alert(1),1600000001,,unread",
      "Good,https://example.com/f,1600000002,,unread",
    ].join("\n")

    const { nodes, skipped } = parseCsvBookmarks(csv, "pocket.csv")

    expect(flatten(nodes)).toEqual([
      "[Pocket]",
      "Good -> https://example.com/f",
    ])
    expect(skipped).toBe(2)
  })

  it("handles a quoted field with an embedded newline without breaking row alignment", () => {
    const csv = [
      "title,note,excerpt,url,folder,tags,created",
      '"Multi\nLine",note,excerpt,https://example.com/g,Notes,,2020-01-01T00:00:00Z',
      "After,,,https://example.com/h,Notes,,2020-01-02T00:00:00Z",
    ].join("\n")

    const { nodes } = parseCsvBookmarks(csv, "raindrop.csv")

    expect(flatten(nodes)).toEqual([
      "[Notes]",
      "Multi\nLine -> https://example.com/g",
      "After -> https://example.com/h",
    ])
  })

  it("returns an empty tree for a file with no url column", () => {
    expect(parseCsvBookmarks("name,notes\nfoo,bar", "x.csv")).toEqual({
      nodes: [],
      skipped: 0,
    })
  })
})
