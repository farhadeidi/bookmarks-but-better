import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"

interface DropIndicatorProps {
  edge: Edge | null
}

/**
 * Renders a thin horizontal line at the top or bottom edge of the parent.
 * Parent must be position: relative.
 */
export function DropIndicator({ edge }: DropIndicatorProps) {
  if (!edge) return null

  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-10 h-0.5 bg-primary"
      style={edge === "top" ? { top: -1 } : { bottom: -1 }}
    />
  )
}
