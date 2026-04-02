import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { buildRootFolderOptions } from "./root-folder-options"

const ROOT_VALUE = "__root__"

interface RootFolderSelectProps {
  value: string | null
  onChange: (id: string | null) => void
  label?: string
  description?: string
}

export function RootFolderSelect({
  value,
  onChange,
  label,
  description,
}: RootFolderSelectProps) {
  const tree = useBookmarkStore((s) => s.tree)

  const folders = React.useMemo(() => buildRootFolderOptions(tree), [tree])

  const displayLabel = value
    ? folders.find((folder) => folder.id === value)?.label ?? value
    : "Browser Root (all bookmarks)"

  return (
    <div className="flex flex-col gap-2">
      {label ? <label className="text-sm font-medium">{label}</label> : null}

      <Select
        value={value ?? ROOT_VALUE}
        onValueChange={(next) => onChange(next === ROOT_VALUE ? null : next)}
      >
        <SelectTrigger className="w-full">
          <span className="truncate">{displayLabel}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ROOT_VALUE}>
            Browser Root (all bookmarks)
          </SelectItem>
          {folders.map((folder) => (
            <SelectItem key={folder.id} value={folder.id}>
              {folder.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}
