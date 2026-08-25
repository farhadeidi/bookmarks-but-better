import { useCallback, useEffect, useState, type ReactNode } from "react";

/**
 * Collapsible dashboard folder card.
 *
 * Each card header exposes a collapse/expand toggle. A collapsed card shows
 * only the folder name and bookmark count. Collapse state is a per-source UI
 * preference persisted to `localStorage`, which is scoped to the browser
 * profile; keying the value by source id gives each Vault source an
 * independent, session-persistent set of collapsed folders.
 */

const STORAGE_PREFIX = "bookmarks-but-better:collapsed-folders:";

/** Builds the `localStorage` key for a source's collapsed folder ids. */
export function storageKey(sourceId: string): string {
  return `${STORAGE_PREFIX}${sourceId}`;
}

function resolveLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the set of collapsed folder ids for a source; empty on any error. */
export function readCollapsedFolders(sourceId: string): Set<string> {
  const storage = resolveLocalStorage();
  if (!storage) {
    return new Set();
  }
  try {
    const raw = storage.getItem(storageKey(sourceId));
    if (raw === null) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set();
  }
}

/** Persists the collapsed folder ids for a source; a no-op when unavailable. */
export function writeCollapsedFolders(
  sourceId: string,
  collapsed: Set<string>,
): void {
  const storage = resolveLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(storageKey(sourceId), JSON.stringify(Array.from(collapsed)));
  } catch {
    // Quota exceeded or storage blocked (private mode): collapse state is
    // best-effort, and the in-memory value still reflects the last action.
  }
}

export interface BookmarkFolderCardProps {
  /** Stable id of the Vault source this dashboard is showing. */
  sourceId: string;
  /** Stable id of the folder this card represents. */
  folderId: string;
  /** The folder's display name. */
  name: string;
  /** Number of bookmarks the folder currently holds. */
  count: number;
  /** The bookmark list rendered while the card is expanded. */
  children: ReactNode;
}

export function BookmarkFolderCard({
  sourceId,
  folderId,
  name,
  count,
  children,
}: BookmarkFolderCardProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    readCollapsedFolders(sourceId),
  );

  // Re-hydrate when the source changes so each source keeps its own set and a
  // stale in-flight value is never written under the wrong source's key.
  useEffect(() => {
    setCollapsed(readCollapsedFolders(sourceId));
  }, [sourceId]);

  const toggle = useCallback(
    (id: string) => {
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        writeCollapsedFolders(sourceId, next);
        return next;
      });
    },
    [sourceId],
  );

  const isCollapsed = collapsed.has(folderId);

  return (
    <section
      aria-label={`${name} folder`}
      className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm"
    >
      <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => toggle(folderId)}
          className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={`text-muted-foreground transition-transform ${
              isCollapsed ? "-rotate-90" : ""
            }`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="truncate">{name}</span>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        </button>
      </header>
      {!isCollapsed && (
        <div id={`bookmark-folder-card-body-${folderId}`} className="p-3">
          {children}
        </div>
      )}
    </section>
  );
}
