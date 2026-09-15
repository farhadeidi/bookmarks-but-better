# Website brand — bookmarks.but-better.dev

The marketing site's visual system, "Modern editorial": a neutral paper and ink
page, one face — Inter — from the hero title down to the smallest label, and
amber as a small accent. The product logo (`public/logo.svg`, `logo-dark.svg`) is unchanged.

**Tone:** calm, precise, trustworthy. **Avoid:** SaaS gradients, glows,
glassmorphism, large colored panels, decorative icons in tinted boxes.

## Type

| Role    | Face                    | Use                                                   |
| ------- | ----------------------- | ----------------------------------------------------- |
| Display | Inter 600, tracked in   | The hero title, section titles, page titles, prose h2 |
| Text    | Inter 400/500           | Everything else: body, nav, buttons, labels, h3+      |

One face does both jobs. Headings are told apart from body text by weight,
tracking and size, not by a second family; `font-display` stays the token for
display type (`--font-display` in `global.css`, `--bbb-font-display` in the
docs) and points at Inter.

- Display sizes: hero `text-5xl`→`text-8xl`; section titles
  `text-3xl`/`sm:text-4xl`; page titles `text-4xl`/`sm:text-5xl`; prose h1/h2
  `text-2xl`. Docs page titles keep Starlight's own size and its h2s step down
  to 0.9 of theirs, so the title still leads.
- Display tuning: `font-semibold` everywhere, with tracking pulled in as the
  size grows — `-0.035em` on the hero and the 404, `-0.03em` on page titles,
  `-0.025em` on section titles and docs h1, `-0.02em` on docs h2, `-0.015em`
  on prose h1/h2. Default line height, `text-balance` (article titles use
  `text-pretty`).
- The hero's "but better" sets *better* apart with weight, not a slant:
  `font-normal` against the semibold line. Inter's italic is a sloped
  grotesque, not an editorial italic, and it reads as a mistake at hero size.
- Eyebrows: `text-sm/6 font-medium` in amber, sentence case.
- Body text is `text-base` on mobile and may step down to `text-sm` at `sm:`.

**Font loading:** one self-hosted file, latin only, through Astro's Fonts API
(`astro.config.ts`), with a metric-matched fallback and a preload link on every
page (`starlight/Head.astro`). It is Inter's `opsz` build, so the same file
carries the weight and optical size axes and display sizes get Inter Display's
drawing without a second download. It uses `font-display: optional`: a face
that misses the short block period stays on the fallback for that view instead
of swapping in later, so text never reflows after first paint. No third-party
font requests.

## Color tokens

Defined once in `src/styles/global.css`; `starlight.css` derives every docs
`--sl-*` color from them, so the docs match in both modes.

| Token                | Light                     | Dark                   |
| -------------------- | ------------------------- | ---------------------- |
| `--background`       | `oklch(0.99 0.002 90)`    | `oklch(0.18 0.003 90)` |
| `--foreground` (ink) | `oklch(0.2 0.005 80)`     | `oklch(0.95 0.002 90)` |
| `--card`             | `oklch(1 0 0)`            | `oklch(0.21 0.003 90)` |
| `--muted`            | `oklch(0.96 0.002 90)`    | `oklch(0.25 0.003 90)` |
| `--muted-foreground` | `oklch(0.47 0.005 80)`    | `oklch(0.7 0.004 90)`  |
| `--primary`          | ink                       | light ink              |
| `--accent`, `--ring` | `oklch(0.55 0.12 60)`     | `oklch(0.72 0.13 70)`  |
| `--border`           | ink at 10%                | white at 10%           |

Measured contrast on the page (light / dark): body 17.6 / 16.2, muted
6.7 / 7.0, primary button text 17.6 / 15.6, amber eyebrow 4.9 / 7.4.

**Amber is an accent, never a fill:** eyebrows, link underlines, the focus
ring, list markers, selection. Buttons are ink.

## Surfaces and motifs

- **One column.** Every marketing section is `max-w-6xl px-6`, split into
  grids with `gap-x-12`. Sections are separated by full-width hairlines that
  echo the header's bottom border.
- **Lightest separation first.** Whitespace, then hairline top borders on
  sibling items (feature notes, the privacy pledges) and dividers in lists
  (sources, FAQ). No cards on the landing page; the only well is the `npx`
  command.
- **Screenshots** are real app captures (`src/assets/screenshots/`), framed by
  a 1px `foreground/10` outline and a radius of `min(1.5vw, radius-xl)`. The
  hero's live preview is framed as a browser tab and is the only element with
  a shadow (removed in dark mode). Dark screenshots stay dark in both modes.
- **Varied, disciplined layouts:** centered hero and closing call to action;
  left-aligned everything between — stacked (features, privacy), split
  (sources, FAQ with a sticky heading) and image-led (themes).
- **Text links** are ink with an amber underline, one style everywhere.
- **Radius:** `rounded-lg` for buttons and wells, `rounded-xl` for the preview
  frame, `rounded-full` only for badges and theme dots.

## Header and footer

- **One header** on every page: the Starlight `Header` override
  (`components/starlight/Header.astro`). It runs full width with 1.5rem side
  padding everywhere, so the logo holds its position between the marketing
  pages and the docs. Brand, text-only section links (Home, Docs, Guides,
  Privacy — Home marks the current page on `/` only, and the logo links there
  too),
  search (a field in the docs, an icon elsewhere), GitHub, the theme toggle and
  the install button.
- **Mobile menus** put the install button full width at the top of their
  footer: the marketing pages' own menu and the docs sidebar
  (`starlight/MobileMenuFooter.astro`).
- **Footer:** logo and a one-sentence blurb, three link columns, then the
  license, version and "loads no analytics" line.

## Install buttons

Browser-aware from `<html data-browser>`, set before first paint in
`Head.astro` (Tailwind variants `firefox:` and `safari:`):

| Visitor                  | Primary (ink)                            | Secondary                  |
| ------------------------ | ---------------------------------------- | -------------------------- |
| Chromium, or without JS  | Add to Chrome                            | Add to Firefox             |
| Firefox                  | Add to Firefox                           | Add to Chrome              |
| Safari                   | Get it for Safari → `/docs/start/safari/` | Add to Chrome, Add to Firefox |

The header button (`InstallCta.astro`) names the same browser, smaller. On
Safari the hero adds a line saying Safari uses the local daemon and is built
from source. Marks are Simple Icons (CC0) in `BrowserIcon.astro`.

## Live demo

The hero shows a static screenshot. "Try it live", a theme dot, or any
"live demo" link (`data-demo-link`) loads the real app (`/preview/`) in place;
nothing heavy loads before that. `/preview/` alone is the app full screen.

## Privacy

No analytics, cookies, third-party scripts or remote fonts, on the site or in
the docs.
