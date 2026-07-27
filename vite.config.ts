/// <reference types="vitest/config" />
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import pkg from "./package.json"

/**
 * `bun run dev:daemon-ui` runs the Vite dev server against the frontend
 * only — the Rust daemon lives in a separate workspace/branch and isn't
 * part of this build. This proxy target is this slice's assumption about
 * where a locally-running daemon will listen; it hasn't been confirmed
 * against the daemon side yet, so treat the port as provisional until both
 * sides agree on it.
 */
const DAEMON_DEV_PROXY_PORT = 47823

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
