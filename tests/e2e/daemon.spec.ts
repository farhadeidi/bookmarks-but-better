import { expect, test } from "@playwright/test"

// Never the product default (52222): the fallback matches run-daemon.sh's
// isolated default port, so running the spec directly cannot touch a real
// daemon. run-daemon.sh always exports the override on top of this.
const baseUrl =
  process.env.BOOKMARKS_BUT_BETTER_E2E_BASE_URL ?? "http://127.0.0.1:52224"

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, init)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} → ${response.status}: ${text}`
    )
  }
  return text.length > 0 ? JSON.parse(text) : undefined
}

async function post(path: string, body: unknown) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** The shape of the daemon's tree, as far as this test needs it. */
interface Node {
  id: string
  stateRevision?: string
  children?: Node[]
}

/** Every child id of a folder, in the order the daemon serves them. */
async function childIds(folderId: string): Promise<string[]> {
  const { tree } = (await api("/tree")) as { tree: Node[] }
  const find = (node: Node): Node | undefined => {
    if (node.id === folderId) return node
    for (const child of node.children ?? []) {
      const found = find(child)
      if (found) return found
    }
    return undefined
  }
  return (find(tree[0])?.children ?? []).map((child) => child.id)
}

test("renders the real daemon vault", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  const { tree } = (await api("/tree")) as { tree: Node[] }
  const rootId = tree[0].id

  // No state revisions anywhere here: appending is the same request whatever
  // order the folder is in, so a client that knows nothing about ordering keeps
  // working exactly as it did.
  const folder = (await post("/folders", {
    parentId: rootId,
    title: "Development",
  })) as Node
  await post("/bookmarks", {
    parentId: folder.id,
    title: "Rust External Edit",
    url: "https://www.rust-lang.org/",
  })

  await page.goto(baseUrl)

  await expect(page.getByText("Development", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Rust External Edit", { exact: true })
  ).toBeVisible()
  await expect(page.getByText("Daemon unavailable")).toHaveCount(0)
  expect(errors).toEqual([])
})

test("serves a manually ordered folder in the order it was given", async () => {
  const { tree } = (await api("/tree")) as { tree: Node[] }
  const rootId = tree[0].id

  const folder = (await post("/folders", {
    parentId: rootId,
    title: "Ordering",
  })) as Node
  const first = (await post("/bookmarks", {
    parentId: folder.id,
    title: "First",
    url: "https://example.com/1",
  })) as Node
  const second = (await post("/bookmarks", {
    parentId: folder.id,
    title: "Second",
    url: "https://example.com/2",
  })) as Node

  expect(await childIds(folder.id)).toEqual([first.id, second.id])

  // A reorder is positional, so it carries the revision the tree just gave us.
  const before = (await api(`/bookmarks/${folder.id}`)) as Node
  await api(`/folders/${folder.id}/order`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stateRevision: before.stateRevision,
      children: [
        { id: second.id, kind: "bookmark" },
        { id: first.id, kind: "bookmark" },
      ],
    }),
  })

  expect(await childIds(folder.id)).toEqual([second.id, first.id])

  // And it survives a rescan, because it is on disk rather than in memory.
  await post("/rescan", {})
  expect(await childIds(folder.id)).toEqual([second.id, first.id])
})
