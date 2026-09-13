import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { COLOR_THEME_IDS, COLOR_THEME_LABELS } from "./color-themes"

/**
 * Every color theme is a self-contained set of tokens in `index.css`, and
 * every one must read comfortably: these checks fail the build when a theme
 * forgets a token or ships text you cannot read.
 */

type Oklch = [l: number, c: number, h: number]
type Tokens = Record<string, Oklch>

const CORE_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
]

/** WCAG AA for body text. */
const TEXT_CONTRAST = 4.5

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8")

function parseTokens(body: string): Tokens {
  const tokens: Tokens = {}
  for (const [, name, l, c, h] of body.matchAll(
    /--([a-z0-9-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/[^)]*)?\)/g
  )) {
    tokens[name] = [Number(l), Number(c), Number(h)]
  }
  return tokens
}

/** The body of the rule whose selector list ends with `selector`. */
function block(selector: string): string {
  const escaped = selector.replace(/[[\]().]/g, "\\$&")
  const match = css.match(
    new RegExp(`(?:^|\\n)(?:[^{}\\n]*,\\s*)?${escaped}\\s*\\{([^}]*)\\}`)
  )
  if (!match) throw new Error(`No CSS block for ${selector}`)
  return match[1]
}

const ROOT = parseTokens(block(".light"))
const DARK = parseTokens(block(".dark"))

function themeTokens(id: string, mode: "light" | "dark"): Tokens {
  const base = mode === "light" ? ROOT : DARK
  if (id === "default") return base
  const selector = `[data-color-theme="${id}"]${mode === "dark" ? ".dark" : ""}`
  return { ...base, ...parseTokens(block(selector)) }
}

function relativeLuminance([l, c, h]: Oklch): number {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const L = l_ ** 3
  const M = m_ ** 3
  const S = s_ ** 3
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  const r = clamp(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S)
  const g = clamp(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S)
  const bl = clamp(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

function contrast(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

describe("color themes", () => {
  it("every theme id has a label", () => {
    for (const id of COLOR_THEME_IDS) {
      expect(COLOR_THEME_LABELS[id]).toBeTruthy()
    }
  })

  it.each(COLOR_THEME_IDS.filter((id) => id !== "default"))(
    "%s defines every core token in both modes",
    (id) => {
      for (const mode of ["light", "dark"] as const) {
        const selector = `[data-color-theme="${id}"]${mode === "dark" ? ".dark" : ""}`
        const own = parseTokens(block(selector))
        const missing = CORE_TOKENS.filter((token) => !(token in own))
        expect(missing, `${selector} is missing tokens`).toEqual([])
      }
    }
  )

  const readablePairs: [fg: string, bg: string][] = [
    ["foreground", "background"],
    ["card-foreground", "card"],
    ["popover-foreground", "popover"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
    ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"],
    ["accent-foreground", "accent"],
  ]

  it.each(
    COLOR_THEME_IDS.flatMap((id) =>
      (["light", "dark"] as const).map((mode) => [id, mode] as const)
    )
  )("%s (%s) keeps its text readable", (id, mode) => {
    const tokens = themeTokens(id, mode)
    for (const [fg, bg] of readablePairs) {
      expect(tokens[fg], `${fg} is not an oklch token`).toBeDefined()
      expect(tokens[bg], `${bg} is not an oklch token`).toBeDefined()
    }
    const failures = readablePairs
      .map(([fg, bg]) => ({ fg, bg, ratio: contrast(tokens[fg], tokens[bg]) }))
      .filter(({ ratio }) => ratio < TEXT_CONTRAST)
      .map(({ fg, bg, ratio }) => `${fg} on ${bg}: ${ratio.toFixed(2)}`)
    expect(failures).toEqual([])
  })
})
