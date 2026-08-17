import { expect, test } from "@playwright/test"

/**
 * The multi-Vault contract against a real daemon hosting two isolated
 * temporary Vaults: discovery answers, vault-scoped operations stay scoped,
 * the legacy unscoped routes answer `vault_required`, and the daemon web app
 * switches among the exposed Vaults client-side.
 */

const baseUrl =
  process.env.BOOKMARKS_BUT_BETTER_E2E_BASE_URL ?? "http://127.0.0.1:52225"

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, init)
  const text = await response.text()
  return {
    status: response.status,
    ok: response.ok,
    body: text.length > 0 ? (JSON.parse(text) as unknown) : undefined,
  }
}

interface Node {
  id: string
  title: string
  children?: Node[]
}

test.beforeAll(async () => {
  // Distinct content per vault — a folder with a bookmark inside, which is
  // the shape the dashboard renders — so scope leaks are visible.
  for (const [vault, folder, title, url] of [
    [
      "reading",
      "Reading Folder",
      "Reading Only Marker",
      "https://reading.example/marker",
    ],
    [
      "archive",
      "Archive Folder",
      "Archive Only Marker",
      "https://archive.example/marker",
    ],
  ] as const) {
    const tree = (
      (await api(`/vaults/${vault}/tree`)) as {
        body: { tree: Node[] }
      }
    ).body
    const rootId = tree.tree[0].id
    const created = (
      (await api(`/vaults/${vault}/folders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: rootId, title: folder }),
      })) as { body: Node }
    ).body
    await api(`/vaults/${vault}/bookmarks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: created.id, title, url }),
    })
  }
})

test("discovery lists both vaults", async () => {
  const response = await api("/vaults")
  expect(response.status).toBe(200)
  const vaults = (response.body as { vaults: { id: string }[] }).vaults.map(
    (vault) => vault.id
  )
  expect(vaults).toEqual(["reading", "archive"])
})

test("daemon health is daemon-level and omits single-vault fields", async () => {
  const response = await api("/health")
  expect(response.status).toBe(200)
  const body = response.body as Record<string, unknown>
  expect(body["status"]).toBe("ok")
  expect(Array.isArray(body["vaults"])).toBe(true)
  expect(body["generation"]).toBeUndefined()
  expect(body["warnings"]).toBeUndefined()
})

test("each vault's tree lists only its own bookmarks", async () => {
  const reading = (
    (await api("/vaults/reading/tree")) as { body: { tree: Node[] } }
  ).body.tree
  const archive = (
    (await api("/vaults/archive/tree")) as { body: { tree: Node[] } }
  ).body.tree

  const titles = (root: Node): string[] =>
    (root.children ?? []).flatMap((child) => [child.title, ...titles(child)])
  expect(titles(reading[0])).toContain("Reading Only Marker")
  expect(titles(reading[0])).not.toContain("Archive Only Marker")
  expect(titles(archive[0])).toContain("Archive Only Marker")
  expect(titles(archive[0])).not.toContain("Reading Only Marker")
})

test("unscoped vault routes answer a stable vault_required error", async () => {
  const response = await api("/tree")
  expect(response.status).toBe(400)
  const body = response.body as { code: string; detail: string }
  expect(body.code).toBe("vault_required")
  expect(body.detail).toContain("/vaults/")
})

test("an unknown vault id is a stable not-found problem", async () => {
  const response = await api("/vaults/nope/tree")
  expect(response.status).toBe(404)
  expect((response.body as { code: string }).code).toBe("unknown_vault")
})

test("the served web app switches between the hosted vaults", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  await page.goto(baseUrl)

  // A fresh profile runs the setup wizard first; skip it to reach the
  // dashboard. The wizard's own source step is absent in the daemon-served
  // build — the daemon is the only source there.
  await page.getByRole("button", { name: "Get Started" }).click()
  // The wizard slides its steps; let the transition settle before skipping.
  await page.waitForTimeout(450)
  await page.getByRole("button", { name: "Skip, use defaults" }).click()

  // Both vaults appear as switchable sources.
  await expect(page.getByRole("tab", { name: /reading/i })).toBeVisible()
  await expect(page.getByRole("tab", { name: /archive/i })).toBeVisible()

  // Sources are listed in a deterministic order — `archive` sorts before
  // `reading` — so the app starts on archive's content.
  await expect(
    page.getByText("Archive Only Marker", { exact: true })
  ).toBeVisible()

  // A switch shows the other vault's content — client-side, with no
  // process-wide active Vault on the daemon.
  await page.getByRole("tab", { name: /reading/i }).click()
  await expect(
    page.getByText("Reading Only Marker", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("Archive Only Marker", { exact: true })
  ).toHaveCount(0)

  await page.getByRole("tab", { name: /archive/i }).click()
  await expect(
    page.getByText("Archive Only Marker", { exact: true })
  ).toBeVisible()

  expect(errors).toEqual([])
})
