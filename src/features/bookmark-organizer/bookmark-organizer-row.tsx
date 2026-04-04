import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowRight01Icon,
  Bookmark02Icon,
  Delete02Icon,
  DragDropHorizontalIcon,
  Folder01Icon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { ItemInstance } from "@headless-tree/core"
import type { OrganizerItemData } from "./bookmark-organizer-types"

interface BookmarkOrganizerRowProps {
  item: ItemInstance<OrganizerItemData>
  onRename: (item: ItemInstance<OrganizerItemData>) => void | Promise<void>
  onDelete: (item: ItemInstance<OrganizerItemData>) => void | Promise<void>
  onCreateItem: (type: "folder" | "bookmark") => void
}

export const BookmarkOrganizerRow = React.memo(function BookmarkOrganizerRow({
  item,
  onRename,
  onDelete,
  onCreateItem,
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
        "group group/row flex items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 transition-colors hover:bg-muted/70",
        itemProps.className
      )}
      style={{
        ...(itemProps.style ?? {}),
        paddingLeft: `${0.5 + level * 1.25}rem`,
      }}
    >
      <button
        type="button"
        aria-label="Drag item"
        className="flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        {...item.getDragHandleProps()}
      >
        <HugeiconsIcon icon={DragDropHorizontalIcon} size={16} />
      </button>

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

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <HugeiconsIcon
          icon={isFolder ? Folder01Icon : Bookmark02Icon}
          size={12}
          className={cn("shrink-0", isFolder ? "text-primary" : "text-muted-foreground")}
        />
        <span className={cn("truncate text-[13px] font-medium leading-5", !isFolder && "text-muted-foreground group-hover:text-foreground transition-colors")}>{title}</span>
      </div>

      <div className="flex items-center gap-1">
        {isFolder && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Add item"
              title="Add item"
              className={buttonVariants({ variant: "secondary", size: "icon-xs", className: "bg-transparent group-hover/row:bg-secondary" })}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              <HugeiconsIcon icon={Add01Icon} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation()
                  onCreateItem("folder")
                }}
              >
                <HugeiconsIcon icon={Folder01Icon} size={14} className="text-primary" />
                New Folder
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(event) => {
                  event.stopPropagation()
                  onCreateItem("bookmark")
                }}
              >
                <HugeiconsIcon icon={Bookmark02Icon} size={14} className="text-muted-foreground" />
                New Bookmark
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          aria-label="Rename item"
          title="Rename"
          className="bg-transparent group-hover/row:bg-secondary"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void onRename(item)
          }}
        >
          <HugeiconsIcon icon={PencilEdit01Icon} />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          aria-label="Delete item"
          title="Delete"
          className="bg-transparent group-hover/row:bg-secondary"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void onDelete(item)
          }}
        >
          <HugeiconsIcon icon={Delete02Icon} />
        </Button>
      </div>
    </div>
  )
})
