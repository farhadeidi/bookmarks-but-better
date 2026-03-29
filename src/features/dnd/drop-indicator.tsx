import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"

interface DropIndicatorProps {
  edge: Edge | null
}

/**
 * Renders a thin line at the closest edge of the parent element.
 * Horizontal line for top/bottom, vertical line for left/right.
 * Parent must have position: relative.
 */
export function DropIndicator({ edge }: DropIndicatorProps) {
  if (!edge) return null

  if (edge === "top" || edge === "bottom") {
    return (
      <div
        className="pointer-events-none absolute right-0 left-0 z-10 h-0.5 bg-primary"
        style={edge === "top" ? { top: -1 } : { bottom: -1 }}
      />
    )
  }

  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-primary"
      style={edge === "left" ? { left: -1 } : { right: -1 }}
    />
  )
}
