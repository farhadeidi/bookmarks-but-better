/// <reference types="vitest/config" />
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import pkg from "./package.json"
import {
  BACKGROUND_OUTPUT_FILE,
  buildEntryNames,
} from "./src/extension/build-contract"

/**
 * `bun run dev:daemon-ui` runs the Vite dev server against the frontend
 * only — the Rust daemon lives in a separate workspace/branch and isn't
 * part of this build. Proxies /api/v1 (and the SSE /api/v1/events stream)
 * to the daemon's fixed local port so the two can be run side by side.
 */
const DAEMON_DEV_PROXY_PORT = 52222

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      input: Object.fromEntries(
        buildEntryNames(process.env.VITE_BUILD_TARGET).map((name) => [
          name,
          path.resolve(
            __dirname,
            name === "index"
              ? "index.html"
              : name === "popup"
                ? "popup.html"
                : "src/extension/background.ts"
          ),
        ])
      ),
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? BACKGROUND_OUTPUT_FILE
            : "assets/[name]-[hash].js",
      },
    },
  },
  server:
    process.env.VITE_BUILD_TARGET === "daemon"
      ? {
          proxy: {
            "/api/v1": `http://127.0.0.1:${DAEMON_DEV_PROXY_PORT}`,
          },
        }
      : undefined,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
})
