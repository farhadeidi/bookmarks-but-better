import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { platformCapabilities } from "@/sources/platform"

/** One key, or key combination, printed the way a keyboard prints it. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  )
}

interface TipProps {
  keys: React.ReactNode
  children: React.ReactNode
}

function Tip({ keys, children }: TipProps) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
      <span className="flex flex-wrap items-center gap-1.5">{keys}</span>
      <p className="text-xs text-muted-foreground">{children}</p>
    </li>
  )
}

/**
 * The last step, and the only one that teaches instead of asking.
 *
 * Each line names something the dashboard never shows: type-to-search has no
 * shortcut to stumble over, `Alt`+arrow has no on-screen affordance, and the
 * omnibox keyword lives outside the page entirely. Untaught, they may as well
 * not exist.
 *
 * Every line is gated on the capability that makes it true, never on a build
 * target or a browser name (ADR 0004). A card promising a new tab page this
 * build replaces nothing of, a keyword this browser has no omnibox for, or a
 * reorder key the Active Source cannot persist, is worse than no card at all.
 */
export function TipsStep() {
  const caps = platformCapabilities()

  // The same pair of questions `use-grid-navigation` asks before it plans a
  // reorder, minus its optimistic `?? true`: where there is no adapter yet —
  // a profile whose only way in is a daemon nobody has connected — the honest
  // answer for a printed promise is "do not make it".
  const canMoveByIndex = useBookmarkStore(
    (s) => s.adapter?.capabilities.reorder ?? false
  )
  const canSetChildOrder = useBookmarkStore(
    (s) =>
      (s.adapter?.capabilities.setChildOrder ?? false) &&
      s.adapter?.bookmarks.setChildOrder !== undefined
  )
  const canReorder = canMoveByIndex || canSetChildOrder

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">You're all set</h2>
        <p className="text-muted-foreground">
          {caps.newTabOverride
            ? "Every new tab is this dashboard. A few things it will never tell you:"
            : "A few things the dashboard will never tell you:"}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        <Tip keys={<Kbd>Any key</Kbd>}>
          Just start typing. Whatever the page is focused on, the first
          character you type opens search and goes into the box — there is no
          shortcut to remember.
        </Tip>

        <Tip
          keys={
            <>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <Kbd>←</Kbd>
              <Kbd>→</Kbd>
            </>
          }
        >
          Move between bookmarks and folders without the mouse.
          {canReorder ? (
            <>
              {" "}
              Hold <Kbd>Alt</Kbd> with <Kbd>↑</Kbd> or <Kbd>↓</Kbd> to move a
              bookmark up or down inside its folder.
            </>
          ) : null}
        </Tip>

        {caps.omnibox && (
          <Tip
            keys={
              <>
                <Kbd>bb</Kbd>
                <span className="text-xs text-muted-foreground">then</span>
                <Kbd>Tab</Kbd>
              </>
            }
          >
            Search your bookmarks from the browser's address bar, without
            leaving the page you are on.
          </Tip>
        )}
      </ul>
    </div>
  )
}
