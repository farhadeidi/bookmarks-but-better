import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BookmarkNode } from "@/browser"

interface RootFolderPickerProps {
  value: string | null
  onChange: (id: string | null) => void
}

function collectFolderPaths(
  node: BookmarkNode,
  path: string[] = []
): { id: string; label: string }[] {
  const currentPath = node.title ? [...path, node.title] : path
  const result: { id: string; label: string }[] = []

  if (node.title) {
    result.push({
      id: node.id,
      label: currentPath.join(" > "),
    })
  }

  if (node.children) {
    for (const child of node.children) {
      if (child.url === undefined) {
        result.push(...collectFolderPaths(child, currentPath))
      }
    }
  }

  return result
}

export function RootFolderPicker({ value, onChange }: RootFolderPickerProps) {
  const tree = useBookmarkStore((s) => s.tree)

  const folders = React.useMemo(() => {
    const all: { id: string; label: string }[] = []
    for (const root of tree) {
      all.push(...collectFolderPaths(root))
    }
    return all
  }, [tree])

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">Root Folder</label>
      <select
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Browser Root (all bookmarks)</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Choose which folder to display as the root of your bookmarks.
      </p>
    </div>
  )
}
