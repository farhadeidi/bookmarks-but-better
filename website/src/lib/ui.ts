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

/**
 * A mat for a screenshot whose own backdrop would merge with the page — the
 * themes montage, which is dark on dark. The card surface sits one step off
 * the page in both modes, so the block reads as an object instead of a hole,
 * and the hairline moves out to the mat. Pair with `SCREENSHOT_MATTED` on the
 * image: the outer radius is the screenshot radius grown by the padding.
 */
export const SCREENSHOT_MAT =
  "rounded-[calc(min(1.5vw,var(--radius-xl))+--spacing(2))] bg-card p-2 outline-1 -outline-offset-1 outline-foreground/10"

/** A screenshot inside `SCREENSHOT_MAT`: the mat already draws the edge. */
export const SCREENSHOT_MATTED = "rounded-[min(1.5vw,var(--radius-xl))]"
