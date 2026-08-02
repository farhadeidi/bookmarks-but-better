/// <reference types="vitest/config" />
import path from "path"
import { defineConfig } from "vite"
import pkg from "./package.json"
import {
  BACKGROUND_OUTPUT_FILE,
  BACKGROUND_OUTPUT_FORMAT,
} from "./src/extension/build-contract"

/**
 * The extension pages and background share adapter-preference modules. Build
 * the background once more as a single IIFE after the multi-entry build so
 * Firefox can load it as a classic MV3 background script without ESM imports.
 * The same self-contained artifact is also valid as Chrome's module service
 * worker. `emptyOutDir: false` preserves the extension pages and assets.
 */
export default defineConfig({
  publicDir: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "./src/extension/background.ts"),
      formats: [BACKGROUND_OUTPUT_FORMAT],
      name: "BookmarksButBetterBackground",
      fileName: () => BACKGROUND_OUTPUT_FILE,
    },
  },
})
