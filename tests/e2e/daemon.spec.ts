import { expect, test } from "@playwright/test"

test("renders the real daemon vault", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  const baseUrl = process.env.BBB_E2E_BASE_URL ?? "http://127.0.0.1:47321"
  const tree = await fetch(`${baseUrl}/api/v1/tree`).then((response) =>
    response.json()
  )
  const rootId = tree.tree[0].id
  const folder = await fetch(`${baseUrl}/api/v1/folders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentId: rootId, title: "Development" }),
  }).then((response) => response.json())
  await fetch(`${baseUrl}/api/v1/bookmarks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parentId: folder.id,
      title: "Rust External Edit",
      url: "https://www.rust-lang.org/",
    }),
  })

  await page.goto(baseUrl)

  await expect(page.getByText("Development", { exact: true })).toBeVisible()
  await expect(
    page.getByText("Rust External Edit", { exact: true })
  ).toBeVisible()
  await expect(page.getByText("Daemon unavailable")).toHaveCount(0)
  expect(errors).toEqual([])
})
