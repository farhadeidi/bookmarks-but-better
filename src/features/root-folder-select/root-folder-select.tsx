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
const ROOT_LABEL = "Browser Root (all bookmarks)"

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

  // A raw id is never a label. Two ways `value` can miss the options list:
  // it is the tree root itself — the daemon and standalone adapters have a
  // real, selectable root, which is deliberately left out of the list because
  // it is the same thing as selecting nothing — or it names a folder that has
  // since been deleted, in which case the app is already falling back and the
  // picker should say so rather than print a UUID.
  const displayLabel = !value
    ? ROOT_LABEL
    : value === tree[0]?.id
      ? ROOT_LABEL
      : (folders.find((folder) => folder.id === value)?.label ??
        "Unavailable folder — using the default")

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
