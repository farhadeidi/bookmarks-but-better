/**
 * The dev-server bootstrap hook: brings the scenario world up before the
 * source store initializes. Imported dynamically (and only) from
 * `useAppBootstrap` on a Vite dev-server page.
 */

export async function bootstrapDevWorkbench(): Promise<void> {
  const { ensureDevRuntime } = await import("./runtime")
  await ensureDevRuntime()
}
