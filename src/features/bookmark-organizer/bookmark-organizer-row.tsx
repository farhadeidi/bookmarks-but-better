import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Delete02Icon,
  Drag04Icon,
  Folder01Icon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ItemInstance } from "@headless-tree/core"
import type { OrganizerItemData } from "./bookmark-organizer-types"

interface BookmarkOrganizerRowProps {
  item: ItemInstance<OrganizerItemData>
  onRename: (item: ItemInstance<OrganizerItemData>) => void | Promise<void>
  onDelete: (item: ItemInstance<OrganizerItemData>) => void | Promise<void>
}

export const BookmarkOrganizerRow = React.memo(function BookmarkOrganizerRow({
  item,
  onRename,
  onDelete,
}: BookmarkOrganizerRowProps) {
  const itemData = item.getItemData()
  const isFolder = itemData?.kind === "folder" || item.isFolder()
  const isExpanded = isFolder && item.isExpanded()
  const title = itemData?.title ?? item.getItemName()
  const level = item.getItemMeta().level
  const itemProps = item.getProps()

  return (
    <div
      {...itemProps}
      className={cn(
        "group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 transition-colors hover:bg-muted/70",
        itemProps.className
      )}
      style={{
        ...(itemProps.style ?? {}),
        paddingLeft: `${0.5 + level * 1.25}rem`,
      }}
    >
      {isFolder ? (
        <button
          type="button"
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (isExpanded) {
              item.collapse()
            } else {
              item.expand()
            }
          }}
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            style={{
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 120ms ease",
            }}
          />
        </button>
      ) : (
        <span className="size-7" aria-hidden="true" />
      )}

      <button
        type="button"
        aria-label="Drag item"
        className="flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        {...item.getDragHandleProps()}
      >
        <HugeiconsIcon icon={Drag04Icon} size={12} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <HugeiconsIcon
          icon={isFolder ? Folder01Icon : ArrowUpRight01Icon}
          size={12}
          className="shrink-0 text-muted-foreground"
        />
        <span className="truncate text-[13px] font-medium leading-5">{title}</span>
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Rename item"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void onRename(item)
          }}
        >
          <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Delete item"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void onDelete(item)
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} />
        </Button>
      </div>
    </div>
  )
})
