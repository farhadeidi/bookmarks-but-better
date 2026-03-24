import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BookmarkNode } from "@/browser"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

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

const ROOT_VALUE = "__root__"

export function RootFolderPicker({ value, onChange }: RootFolderPickerProps) {
  const tree = useBookmarkStore((s) => s.tree)

  const folders = React.useMemo(() => {
    const all: { id: string; label: string }[] = []
    for (const root of tree) {
      all.push(...collectFolderPaths(root))
    }
    return all
  }, [tree])

  const displayLabel = value
    ? folders.find((f) => f.id === value)?.label ?? value
    : "Browser Root (all bookmarks)"

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">Root Folder</label>
      <Select
        value={value ?? ROOT_VALUE}
        onValueChange={(val) => onChange(val === ROOT_VALUE ? null : val)}
      >
        <SelectTrigger className="w-full">
          <span className="truncate">{displayLabel}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ROOT_VALUE}>
            Browser Root (all bookmarks)
          </SelectItem>
          {folders.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Choose which folder to display as the root of your bookmarks.
      </p>
    </div>
  )
}
