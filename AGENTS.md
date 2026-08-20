# Bookmarks But Better

A browser extension (Chrome, Firefox, Safari) that replaces the new-tab page with
a bookmarks dashboard, plus an optional local daemon that serves bookmarks from
Markdown vaults. It serves end users who want their bookmarks organized and
private: there is no account, analytics, tracking, or bookmark-content collection.

## Product rules

- Bookmarks come from **sources** that are never implicitly merged. Operations
  affect only the currently **Active Source**; switching sources never merges or
  moves bookmarks.
- **Privacy:** the daemon binds to `127.0.0.1`/`localhost` only. Do not add
  telemetry, accounts, or any collection of bookmark content.
- The legacy **Standalone Source** is retiring over one major version. Migration
  is an explicit copy that leaves the legacy data intact.
- Browser differences are **Platform Capabilities**, not browser-name branches;
  unsupported capabilities are omitted rather than branched around. Safari is
  daemon-only.
- One product version spans `package.json`, `Cargo.toml`, and every extension
  manifest; a release tag names a single number.

## Shape

- **Frontend** (React 19 + Vite + Tailwind v4 + shadcn/ui, Bun): sources and
  adapters under `src/sources/` and `src/browser/{chrome,firefox,standalone,daemon}/`;
  state in `src/stores/`.
- **Daemon** (Rust workspace): `crates/bookmarks-but-better` (server, CLI,
  service) and `crates/bookmarks-but-better-vault-core` (vault domain library).
- **Distribution:** extension builds (`dist-*`), npm launcher
  (`packages/bookmarks-but-better`), install scripts (`install.sh`, `install.ps1`).
- **Dev Workbench** (`bun run dev`) runs the full app with URL-addressable
  scenarios and no extension or daemon.

## UI components (shadcn/ui)

UI is shadcn/ui configured in `components.json` — `base-maia` style, `hugeicons`
icon library, Tailwind v4 CSS variables. When adding, fixing, or styling a
component, get its current API from `https://ui.shadcn.com/llms.txt` or the
component's docs page (`https://ui.shadcn.com/docs/components/<name>`) instead of
guessing.

## Verification

- Frontend/TS: `bun run check` (format, lint, typecheck, test, builds). Targeted:
  `bun run typecheck`, `bun run lint`, `bun run test`.
- Rust: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets
  --all-features -- -D warnings`, `cargo test --workspace --all-features`.
- UI/e2e: `bun run test:ui`, `bun run test:e2e:daemon`,
  `bun run test:e2e:multi-vault`.
- Full command list: `README.md` → Development.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on this repository. The roadmap board is the GitHub project "Bookmarks But Better - Roadmap" (https://github.com/users/farhadeidi/projects/6). Use `gh` for tracker operations; do not invent another tracker, and do not use Linear. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles use their default strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

## On-demand docs

- Before publishing a release, read `docs/RELEASING.md` in full.
- Daemon install and configuration: `docs/DAEMON.md`.
- Dev Workbench scenarios: `docs/DEV_WORKBENCH.md`.
- Safari build, signing and manual QA: `docs/SAFARI.md`.
