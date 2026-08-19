import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import { searchBookmarks } from "./bookmark-search"

const TREE: BookmarkNode[] = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "bar",
        title: "Bookmarks Bar",
        children: [
          {
            id: "dev",
            title: "Dev",
            children: [
              {
                id: "github",
                title: "GitHub",
                url: "https://github.com",
              },
              {
                id: "legit",
                title: "Legit Blog",
                url: "https://blog.example.com/legit",
              },
            ],
          },
          {
            id: "reading",
            title: "Reading",
            children: [
              {
                id: "docs",
                title: "MDN",
                url: "https://developer.mozilla.org/docs",
              },
            ],
          },
        ],
      },
    ],
  },
]

function ids(query: string): string[] {
  return searchBookmarks(TREE, query).map((hit) => hit.id)
}

describe("searchBookmarks", () => {
  it("finds nothing for an empty or whitespace-only query", () => {
    expect(searchBookmarks(TREE, "")).toEqual([])
    expect(searchBookmarks(TREE, "   ")).toEqual([])
  })

  it("matches bookmark titles regardless of case", () => {
    expect(ids("github")).toContain("github")
    expect(ids("GITHUB")).toContain("github")
    expect(ids("GiThUb")).toContain("github")
  })

  it("matches folder titles too, so a folder can be found and revealed", () => {
    const hits = searchBookmarks(TREE, "reading")
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ id: "reading", kind: "folder" })
    expect(hits[0].url).toBeUndefined()
  })

  it("matches a URL nothing in the title matches", () => {
    const hits = searchBookmarks(TREE, "mozilla")
    expect(hits.map((hit) => hit.id)).toEqual(["docs"])
    expect(hits[0].kind).toBe("bookmark")
  })

  it("ranks a title prefix above a title substring", () => {
    // "GitHub" starts with the query; "Legit Blog" merely contains it.
    expect(ids("git")).toEqual(["github", "legit"])
  })

  it("ranks a URL prefix above a title substring", () => {
    const hits = searchBookmarks(
      [
        { id: "substring", title: "My Example Notes" },
        { id: "prefix", title: "Notes", url: "https://example.com/notes" },
      ],
      "example"
    )
    expect(hits.map((hit) => hit.id)).toEqual(["prefix", "substring"])
  })

  it("treats the host as the start of a URL, not the scheme", () => {
    const [hit] = searchBookmarks(TREE, "developer.mozilla")
    // A substring match would still find it; only a prefix match outranks
    // unrelated title hits, which is the point of ignoring "https://".
    expect(hit.score).toBeGreaterThan(searchBookmarks(TREE, "mozilla")[0].score)
  })

  it("ignores a leading www. the way a user typing a host does", () => {
    const hits = searchBookmarks(
      [{ id: "site", title: "Untitled", url: "https://www.example.com" }],
      "example.com"
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].score).toBe(
      searchBookmarks(
        [{ id: "site", title: "Untitled", url: "https://example.com" }],
        "example.com"
      )[0].score
    )
  })

  it("keeps tree order between equally scored hits", () => {
    // Both are title prefix matches: the one written first stays first.
    const hits = searchBookmarks(
      [
        { id: "first", title: "Alpha One", url: "https://one.example.com" },
        { id: "second", title: "Alpha Two", url: "https://two.example.com" },
      ],
      "alpha"
    )
    expect(hits.map((hit) => hit.id)).toEqual(["first", "second"])
  })

  it("reports the folder path, since a hit can sit outside the shown root", () => {
    const [hit] = searchBookmarks(TREE, "github")
    expect(hit.folderPath).toEqual(["Bookmarks Bar", "Dev"])
  })

  it("leaves an untitled synthetic root out of the folder path", () => {
    const [hit] = searchBookmarks(TREE, "reading")
    expect(hit.folderPath).toEqual(["Bookmarks Bar"])
  })

  it("searches the whole forest it is handed, at any depth", () => {
    expect(ids("legit")).toEqual(["legit"])
  })

  it("keeps only the best hits when a limit is given", () => {
    expect(searchBookmarks(TREE, "git", { limit: 1 }).map((h) => h.id)).toEqual(
      ["github"]
    )
  })

  it("finds nothing in an empty tree", () => {
    expect(searchBookmarks([], "anything")).toEqual([])
  })
})
