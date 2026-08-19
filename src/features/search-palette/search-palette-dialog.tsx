import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Bookmark02Icon,
  Folder01Icon,
  FolderTreeIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { searchBookmarks, type BookmarkSearchHit } from "@/lib/bookmark-search"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { navigableUrl } from "@/lib/navigable-url"
import { openResultUrl } from "./open-result"

/**
 * Enough rows to make refining the query unnecessary at the collection sizes
 * this product is built for, and few enough that the list stays scannable
 * rather than becoming a second thing to search.
 */
const RESULT_LIMIT = 25

const LIST_ID = "search-palette-results"

function optionId(index: number): string {
  return `search-palette-option-${index}`
}

function describeLocation(hit: BookmarkSearchHit): string {
  // The path first: the search covers the whole Active Source, so where a hit
  // lives is the thing the dashboard cannot already tell the user.
  return [hit.folderPath.join(" > "), hit.url].filter(Boolean).join(" · ")
}

export function SearchPaletteDialog() {
  const palette = useUIStore((s) => s.searchPalette)
  const closeSearchPalette = useUIStore((s) => s.closeSearchPalette)
  const revealInBookmarkOrganizer = useUIStore(
    (s) => s.revealInBookmarkOrganizer
  )
  // The whole Active Source, not the dashboard's root subtree — and never
  // more than one source, since the store only ever holds the active one.
  const tree = useBookmarkStore((s) => s.tree)

  const [query, setQuery] = React.useState("")
  const [highlighted, setHighlighted] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const activeRowRef = React.useRef<HTMLDivElement>(null)

  // A fresh request object per open, so the character that opened the palette
  // seeds it every time — including opening it again on the same character.
  React.useEffect(() => {
    if (!palette) return
    setQuery(palette.seedQuery)
    setHighlighted(0)
  }, [palette])

  const results = React.useMemo(
    () => searchBookmarks(tree, query, { limit: RESULT_LIMIT }),
    [tree, query]
  )

  // Clamped rather than stored back: results change on every keystroke, and a
  // highlight that outlives its row would open something the user can't see.
  const activeIndex =
    results.length === 0 ? -1 : Math.min(highlighted, results.length - 1)
  const activeHit = activeIndex === -1 ? undefined : results[activeIndex]

  React.useEffect(() => {
    activeRowRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [activeIndex, results])

  function openHit(hit: BookmarkSearchHit, background: boolean) {
    const url = navigableUrl(hit.url)
    // Folders have nowhere to navigate to, and neither does a bookmark whose
    // URL this page may not follow — revealing it is the honest answer to
    // "open" for both, rather than doing nothing.
    if (!url) {
      revealInBookmarkOrganizer(hit.id)
      return
    }

    // A background tab means the user is still here: leaving the palette open
    // is what lets them open several in a row.
    if (!background) closeSearchPalette()
    openResultUrl(url, { background })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0 || activeIndex === -1) return

    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlighted((activeIndex + 1) % results.length)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlighted((activeIndex - 1 + results.length) % results.length)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      openHit(results[activeIndex], event.metaKey || event.ctrlKey)
    }
  }

  const trimmedQuery = query.trim()

  return (
    <Dialog
      open={palette !== null}
      onOpenChange={(open) => {
        if (!open) closeSearchPalette()
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Focus belongs in the search box, not on the popup: the palette is
        // opened by typing, and the next character has to land in the query.
        initialFocus={inputRef}
        className="top-[12vh] translate-y-0 gap-0 rounded-3xl p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Search bookmarks</DialogTitle>
        <DialogDescription className="sr-only">
          Searches the whole active source. Use the up and down arrows to move
          between results, Enter to open one in this tab, Command or Control
          with Enter to open it in a background tab, and Escape to close.
        </DialogDescription>

        <div className="flex items-center gap-2.5 border-b border-border/70 px-4 py-3">
          <HugeiconsIcon
            icon={Search01Icon}
            size={16}
            className="shrink-0 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
            }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-label="Search bookmarks"
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-controls={LIST_ID}
            aria-activedescendant={
              activeIndex === -1 ? undefined : optionId(activeIndex)
            }
            placeholder="Search this source…"
            className="h-7 rounded-none border-0 bg-transparent px-0 focus-visible:border-0 focus-visible:ring-0"
          />
        </div>

        {/* Announced instead of counted on screen: a sighted user can see how
            many rows there are, and a live count would read out on every
            keystroke otherwise. */}
        <div role="status" aria-live="polite" className="sr-only">
          {trimmedQuery === ""
            ? ""
            : `${results.length} ${results.length === 1 ? "result" : "results"}`}
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {trimmedQuery === ""
              ? "Type to search this source."
              : tree.length === 0
                ? // The dashboard says why; repeating its error here would put
                  // two explanations of one problem on screen at once.
                  "No bookmarks are loaded."
                : "Nothing in this source matches."}
          </p>
        ) : (
          <ScrollArea className="max-h-[min(24rem,50vh)]">
            <div
              id={LIST_ID}
              role="listbox"
              aria-label="Search results"
              className="flex flex-col gap-0.5 p-1.5"
            >
              {results.map((hit, index) => (
                <div
                  key={hit.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  ref={index === activeIndex ? activeRowRef : undefined}
                  onMouseMove={() => setHighlighted(index)}
                  onClick={(event) =>
                    openHit(hit, event.metaKey || event.ctrlKey)
                  }
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-2xl px-2.5 py-2",
                    index === activeIndex && "bg-muted"
                  )}
                >
                  <HugeiconsIcon
                    icon={hit.kind === "folder" ? Folder01Icon : Bookmark02Icon}
                    size={16}
                    className={cn(
                      "shrink-0",
                      hit.kind === "folder"
                        ? "text-primary"
                        : "text-muted-foreground"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {hit.title ||
                        (hit.kind === "folder"
                          ? "Untitled Folder"
                          : "Untitled Bookmark")}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {describeLocation(hit)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border/70 px-3 py-2">
          <p className="hidden text-xs text-muted-foreground sm:block">
            ↑↓ move · ↵ open · ⌘/Ctrl ↵ background tab · Esc close
          </p>
          <Button
            variant="outline"
            size="xs"
            disabled={activeHit === undefined}
            // Named after the highlighted row so that what it will reveal is
            // legible before it is pressed — the highlight follows the mouse.
            aria-label={
              activeHit
                ? `Reveal ${activeHit.title} in Bookmark Organizer`
                : "Reveal in Bookmark Organizer"
            }
            onClick={() => {
              if (activeHit) revealInBookmarkOrganizer(activeHit.id)
            }}
          >
            <HugeiconsIcon icon={FolderTreeIcon} size={14} />
            Reveal in organizer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
