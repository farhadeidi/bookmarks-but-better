# Website Brand Direction — bookmarks.but-better.dev

Source of truth for the marketing site's visual identity. Generated via the
`ui-brand-kit` workflow (written spec in place of the rendered board — the
image renderer is unavailable in this environment). The product's existing
logo (`public/logo.svg`) is retained; everything else below is the site's own
identity.

## Brand Positioning

- **Audience:** people whose bookmarks are a mess and whose new tab page is
  wasted space; privacy-conscious users who want local-first tooling.
- **Positioning:** a calm, beautiful, private tool — open source, no accounts,
  no tracking.
- **Tone:** editorial, warm, precise, quiet, trustworthy.
- **Avoid:** generic SaaS dashboard look, purple-blue gradients, glassmorphism,
  Inter-only typography, dark-hacker aesthetics, playful mascots.

## Aesthetic Concept — "The Quiet Library"

A bookmark is a reading object. The site behaves like a beautifully typeset
library catalog: paper tones, ink typography, hairline rules, index-style
section numbers (`01`, `02`…), and a bookmark-ribbon accent. Restraint and
proportion carry the design — generous whitespace, one accent color.

## Typography

| Role   | Typeface                | Notes                                  |
| ------ | ----------------------- | -------------------------------------- |
| Display | Fraunces Variable (serif) | Headlines, section titles; tight tracking, slightly low weight (500–600) |
| UI/Body | Inter Variable          | Body copy, nav, labels, code            |

Both are self-hosted (latin subset) through Astro's Fonts API; the Starlight
docs use the same pair, with Fraunces for page titles and headings.

## Color

Light (paper):

| Role       | Value     |
| ---------- | --------- |
| Background | `oklch(0.985 0.004 95)` — warm paper |
| Foreground | `oklch(0.205 0.01 80)` — ink |
| Primary    | `oklch(0.55 0.12 60)` — burnt amber (buttons, links, ribbons) |
| Muted      | `oklch(0.5 0.01 80)` |
| Border     | ink at 11% opacity — hairline that adapts to any surface |
| Card       | `oklch(1 0 0)` |

Dark (lamplight):

| Role       | Value     |
| ---------- | --------- |
| Background | `oklch(0.17 0.006 80)` — deep ink |
| Foreground | `oklch(0.94 0.004 90)` |
| Primary    | `oklch(0.72 0.13 70)` — lamp amber |
| Border     | `oklch(1 0 0 / 11%)` |

Amber is the only load-bearing accent. Semantic colors (green/red) appear
rarely, as small chips only.

## Motifs

- **Index numbers** — each landing section opens with `01 —`, `02 —` in
  Fraunces italic, like catalog entries, with a hairline extending to the
  right edge.
- **Hairline rules** — 1px borders divide sections; no drop shadows except on
  the interactive demo and screenshots (plus a faint amber glow behind the
  demo).
- **Ribbon** — retired: the hero title is pure Fraunces typography
  ("Bookmarks, / *but better*") with no attached mark.
- **The demo is the hero** — a static screenshot of the real dashboard, framed
  as a browser tab, replaces stock hero imagery and is the page's first large
  paint. A "Try it live" button swaps in the real app (the `/app-preview/`
  build) in place; the theme dots and the themes gallery launch it too, then
  steer its theme. Nothing heavy loads until the visitor asks. The full-screen
  `/preview/` page loads the live app straight away.
- **Docs** — the Starlight docs at `/docs/` carry the same paper and lamplight
  palette, amber accent and type pair, and follow the site's dark-mode choice.
