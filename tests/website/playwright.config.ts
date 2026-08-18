import { fileURLToPath } from "node:url"
import { defineConfig } from "@playwright/test"

const distDir = fileURLToPath(new URL("../../website/dist", import.meta.url))

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
    command: `python3 -m http.server 5180 --bind 127.0.0.1 --directory "${distDir}"`,
    url: "http://127.0.0.1:5180",
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
