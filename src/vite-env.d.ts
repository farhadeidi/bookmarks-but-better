/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __MARKETING_PREVIEW__: boolean

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET: "chrome" | "firefox" | "daemon" | undefined
}
