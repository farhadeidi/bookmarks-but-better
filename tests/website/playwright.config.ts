import { fileURLToPath } from "node:url"
import { defineConfig } from "@playwright/test"

const server = fileURLToPath(new URL("./static-server.mjs", import.meta.url))

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  timeout: 30_000,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:5180",
    trace: "retain-on-failure",
  },
  webServer: {
    // Mirrors GitHub Pages, including the site's custom 404 page.
    command: `node "${server}"`,
    url: "http://127.0.0.1:5180/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
