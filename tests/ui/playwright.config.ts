import { defineConfig } from "@playwright/test"

/**
 * UI tests for the Dev Workbench and the application running inside its
 * simulated world.
 *
 * Isolation is the contract here:
 *
 * - a dedicated dev-server port, never the default `5173` a developer may
 *   already be running, and never a port any real daemon listens on;
 * - `reuseExistingServer: false`, so a run always starts from a known
 *   server, and a fresh browser context per test means fresh IndexedDB —
 *   which is exactly the deterministic-per-scenario world the workbench
 *   seeds;
 * - the simulated daemon is in-memory, so nothing in this suite can ever
 *   contact a real daemon or port 52222.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  timeout: 30_000,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:5179",
    trace: "retain-on-failure",
  },
  webServer: {
    // `--host 127.0.0.1`: Vite's default localhost bind can be IPv6-only,
    // which would leave this IPv4 probe dead even with the server up.
    command: "bun run dev --port 5179 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5179",
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
