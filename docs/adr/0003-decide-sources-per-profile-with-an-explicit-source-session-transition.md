---
status: accepted
---

# Decide sources per profile with an explicit Source Session transition

Bookmark Sources are configured per browser profile in one persisted, never-synced Source Configuration: a set of enabled sources plus exactly one Active Source. Browser Sources and Daemon Sources (each Vault of each connected daemon) are separate collections — there is no merged view and no implicit move between sources.

Switching the Active Source is an explicit **Source Session transition**, not per-call routing: the previous session's listeners and SSE stream are disposed, in-flight work is expired against a session token, node-bound UI is closed, the bookmark and preferences stores are re-initialized against the new concrete adapter, and the selection is persisted. An unreachable daemon stays selected and reports its failure; there is never a silent fallback to the Browser Source, which would show a different set of bookmarks and read as data loss.

## Considered Options

- A routing layer that picks the adapter per call was rejected: bookmark stores would need to branch on the source for every operation, and stale async work from one source could land in another's view.
- Browser reload on switch (the pre-existing behaviour) was rejected: it disposes everything by brute force, loses UI state wholesale, and makes a daemon outage look like a broken page rather than an actionable source state.

## Consequences

- Disabling a source retains its configuration (a disabled daemon Vault keeps its address and token); forgetting a daemon connection is the separate, destructive action that removes them. At least one usable source must remain enabled, enforced by the configuration helpers the UI goes through.
- The capture popup and the omnibox read the same persisted configuration the dashboard wrote, which is what makes the Active Source profile-wide rather than per-surface.
- Client preferences split by lifetime: profile-wide ones (theme, layout width, nested folders) live in a fixed profile namespace; source-scoped ones (root folder, per-folder layouts and order) live behind the active source's storage, namespaced by Vault for daemon sources.
