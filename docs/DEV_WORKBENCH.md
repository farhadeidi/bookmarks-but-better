# The Dev Workbench

`bun run dev` opens the full application as a **browser-based Dev Workbench**: the complete dashboard, popup-free and extension-free, running against a simulated world instead of a real browser profile or a real daemon. Open it in a clean browser profile and everything works — no extension install, no `bookmarks-but-better` daemon, no port 52222.

```sh
bun run dev          # http://localhost:5173 — the default scenario
bun run test:ui      # Playwright coverage against an isolated dev server (port 5179)
```

## Scenarios

The workbench (bottom-left pill) exposes deterministic, URL-addressable scenarios:

| URL | Scenario |
| --- | --- |
| `/?scenario=fresh-chrome` | A brand-new extension profile: empty Browser Source, onboarding still to do. The one scenario with the extension and omnibox capabilities, so the wizard's source question and its `bb` tip are visible here |
| `/?scenario=browser-only` | Browser bookmarks, no daemon |
| `/?scenario=browser-daemon` *(default)* | Browser bookmarks plus a daemon hosting the `reading` and `archive` Vaults |
| `/?scenario=multi-vault` | One daemon hosting four Vaults, no Browser Source |
| `/?scenario=daemon-offline` | Browser plus a currently unreachable daemon |
| `/?scenario=slow-daemon` | Every daemon operation takes 1.2s — loading states on display |
| `/?scenario=legacy-standalone` | A sunset-cohort profile with the legacy Standalone source active |
| `/?scenario=safari` | Safari's world: no Browser Source, a daemon Vault is the only way in |
| `/?scenario=fresh-safari` | Safari's world before setup: no source, and onboarding with no source question |
| `/?scenario=empty` | Nothing enabled — the dashboard's own empty state |
| `/?scenario=large-library` | Hundreds of seeded bookmarks |

- **Scenario state persists** in IndexedDB while you develop: mutations, the active source and preference changes all survive reloads. Navigating without a `?scenario` parameter keeps the persisted scenario; navigating with one applies it.
- **Reset Scenario** deterministically restores the seed: the revision bumps, every simulated source and the profile's Source Configuration are reseeded, and the page reloads into the scenario's URL.

## Failure controls

All controls describe the simulated daemon — the browser source has no failure path worth faking:

- **Daemon online** — off: health reports not-ready, reads and writes fail; the dashboard shows the unavailable state with Retry.
- **Latency** — added to every simulated daemon operation.
- **Deny connect permission** — Connect fails at its permission step.
- **Discovery failure** — vault discovery fails; Connect fails at discovery.
- **Mutation failure** — the daemon refuses every change.
- **Stale mutations** — changes are rejected with the daemon's `stale_revision` problem code.

There is deliberately no "SSE reconnect" control: the `BookmarkAdapter` event surface is plain `onChanged/onCreated/onRemoved/onMoved` callbacks with no reconnect concept, and faking one would add a dev-only abstraction the application never sees. Likewise the dev daemon needs no search surface — only the omnibox searches, and the omnibox does not exist on a dev-server page.

## How it stays out of production

The environment-specific parts of the source model live behind the **SourceEnvironment seam** (`src/sources/environment.ts`): capabilities, adapter construction, daemon connect/discovery, and releasing daemon access. Production pages get the production environment (extension and daemon-served builds, unchanged). A dev-server page resolves the Dev Workbench's simulated environment instead — through dynamic imports guarded by build-time constants, so `bun run build`, `build:daemon` and `build:safari` eliminate the entire dev chunk (verified: no workbench or runtime string appears in any production bundle).

The simulated sources are **not** the deprecated Standalone adapter. They are mutable engines (`src/dev/engine.ts`) behind the same `BrowserAdapter` interface production uses, with capabilities that honestly describe their source: browser-flavored adapters order through `move(id, {index})`; daemon-flavored ones append on move and order through `setChildOrder`, exactly like the real daemon contract.

## Layout of `src/dev/`

- `scenarios.ts` — the scenario registry and its deterministic seeds
- `state.ts` — the workbench's IndexedDB (`bookmarks-but-better-dev`) and failure controls
- `engine.ts` — the mutable, persisted bookmark tree behind every simulated source
- `adapters.ts` — `BrowserAdapter` implementations, including the daemon fault gate
- `runtime.ts` — bootstrap, URL addressing, deterministic reset, capability installation
- `environment.ts` — the simulated SourceEnvironment (connect/discovery without any network)
- `workbench.tsx` — the collapsible scenario panel
