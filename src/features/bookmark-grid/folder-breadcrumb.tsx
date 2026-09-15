import * as React from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BookmarkNode } from "@/browser"

interface FolderBreadcrumbProps {
  /** From the display root down to the open folder, both ends included. */
  path: BookmarkNode[]
  /** What the display root is called here, which is not always its title. */
  rootLabel: string
}

/**
 * The way back out of a folder opened from a folder tile. Every folder above
 * the open one is a step back to it; the first step is the display root, i.e.
 * nothing open at all.
 */
export function FolderBreadcrumb({ path, rootLabel }: FolderBreadcrumbProps) {
  const browseFolder = useBookmarkStore((s) => s.browseFolder)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {path.map((folder, index) => {
          const label = index === 0 ? rootLabel : folder.title
          return (
            <React.Fragment key={folder.id}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {index === path.length - 1 ? (
                  <BreadcrumbPage className="truncate">{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={
                      <button
                        type="button"
                        className="truncate"
                        onClick={() =>
                          browseFolder(index === 0 ? null : folder.id)
                        }
                      />
                    }
                  >
                    {label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
