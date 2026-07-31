/// <reference types="node" />

import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const bootstrapSource = readFileSync(
  new URL("../../public/theme-bootstrap.js", import.meta.url),
  "utf8"
)

function runBootstrap(options?: {
  storedTheme?: string | null
  systemDark?: boolean
  storageThrows?: boolean
}) {
  const classes = new Set<string>()
  const style: { colorScheme?: string } = {}

  runInNewContext(bootstrapSource, {
    document: {
      documentElement: {
        classList: {
          add: (className: string) => classes.add(className),
        },
        style,
      },
    },
    localStorage: {
      getItem: () => {
        if (options?.storageThrows) {
          throw new Error("Storage unavailable")
        }

        return options?.storedTheme ?? null
      },
    },
    window: {
      matchMedia: () => ({ matches: options?.systemDark ?? false }),
    },
  })

  return { classes, colorScheme: style.colorScheme }
}

describe("theme bootstrap", () => {
  it("defaults to dark before the app loads", () => {
    const result = runBootstrap()

    expect(result.classes).toEqual(new Set(["dark"]))
    expect(result.colorScheme).toBe("dark")
  })

  it("applies a saved light theme", () => {
    const result = runBootstrap({ storedTheme: "light" })

    expect(result.classes).toEqual(new Set(["light"]))
    expect(result.colorScheme).toBe("light")
  })

  it.each([
    [true, "dark"],
    [false, "light"],
  ] as const)(
    "resolves a system theme when dark is %s",
    (systemDark, theme) => {
      const result = runBootstrap({ storedTheme: "system", systemDark })

      expect(result.classes).toEqual(new Set([theme]))
      expect(result.colorScheme).toBe(theme)
    }
  )

  it("falls back to dark when storage is unavailable", () => {
    const result = runBootstrap({ storageThrows: true })

    expect(result.classes).toEqual(new Set(["dark"]))
    expect(result.colorScheme).toBe("dark")
  })
})
