/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET: 'chrome' | 'firefox' | undefined
}
