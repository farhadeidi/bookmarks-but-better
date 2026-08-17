---
status: accepted
---

# Retire the Standalone Source over one major version

The Standalone Source — the browser-local IndexedDB collection that predates the daemon — is being removed from the product. New users cannot select it from onboarding or Settings; profiles that were actively using it when the sunset began keep access until the next major version removes it, with a persistent deprecation notice recommending the Browser Source or a Daemon Source.

## Considered Options

- An immediate removal was rejected: profiles with real bookmarks in the Standalone collection would lose their dashboard on upgrade with no path forward.
- Keeping Standalone indefinitely was rejected: two browser-local sources (Browser and Standalone) with near-identical UX is permanent conceptual cost for a capability the daemon serves better.
- A destructive auto-migration was rejected: silently copying (or deleting) a user's bookmarks on upgrade is exactly the kind of surprise the daemon's own mutation rules exist to prevent.

## Consequences

- The migration path is an explicit copy through the ordinary import pipeline — preview, conflict resolution, copy, verification by re-reading the destination — and it never deletes legacy data. The Standalone collection stays readable in Settings → Data & Migration for the whole sunset.
- Migration is flagged per profile: the v1 → v2 Source Configuration migration marks Standalone entries `legacy`, and normalization drops the source entirely for profiles without that flag. New profiles can therefore never acquire it.
- The removal in the next major version is bounded by construction: the adapter lives behind one factory (`createStandaloneAdapter`) and the sunset UI behind one feature module; deleting those two plus the legacy-flag normalization removes the source.
