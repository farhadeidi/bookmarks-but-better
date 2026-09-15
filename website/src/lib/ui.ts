/**
 * Class lists the marketing pages share, so each treatment is defined once:
 * buttons, text links and screenshot frames. (Tailwind reads the literals
 * from this file.)
 */

/** Size, shape and focus ring. Add horizontal padding: `pr-4 pl-3` with a leading icon, `px-4` without. */
export const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg py-3 text-base/6 font-medium ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm/5"

/** Ink fill. One per view: the hero, the closing call to action, the 404. */
export const PRIMARY =
  "bg-primary text-primary-foreground ring-primary hover:bg-primary/90"

export const SECONDARY = "bg-card text-foreground ring-border hover:bg-muted"

/** Inline and standalone text links: ink, with the amber underline. */
export const TEXT_LINK =
  "font-medium text-foreground underline decoration-accent underline-offset-4 hover:decoration-foreground"

/** Screenshots: a hairline edge and a radius that shrinks with the viewport. */
export const SCREENSHOT =
  "rounded-[min(1.5vw,var(--radius-xl))] outline-1 -outline-offset-1 outline-foreground/10"
