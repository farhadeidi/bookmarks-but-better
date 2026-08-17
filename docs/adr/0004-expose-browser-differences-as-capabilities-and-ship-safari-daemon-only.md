---
status: accepted
---

# Expose browser differences as capabilities, and ship Safari daemon-only

Product code works in terms of capability questions — does a Browser Source exist here, can this client reach a daemon, does the omnibox integration exist — answered once per load by the platform seam. Concrete browser names and API probes stay inside that seam, the adapters, and the build wiring (one manifest and one build script per target).

Safari is a supported target and is daemon-only: its WebExtensions implementation has no bookmarks API and no omnibox, so the Browser Source and the omnibox keyword simply do not exist there. The extension builds for Chrome/Chromium and Firefox support Browser Sources plus Daemon Sources. The daemon itself never depends on a UI: it serves its API with or without the optional static web app.

## Considered Options

- `if (isSafari)` branches in feature code were rejected: they multiply per feature, drift from the actual API surface, and turn every new target into a sweep of the codebase.
- Claiming every WebExtension browser was rejected as dishonest: only tested targets are supported, and the capability seam is what makes omitting an untested capability cheap.

## Consequences

- The Safari build is practical and unprivileged: a manifest without `bookmarks`/`omnibox`/new-tab override, a popup that labels its destination and can open the dashboard in a tab, and loopback daemon connections. No signing, credentials, or App Store steps are part of the build itself.
- A Safari profile starts with no sources (there is no Browser Source to enable); connecting a daemon is the only path in, and the dashboard says so rather than guessing.
- Runtime API presence is checked alongside the build target, so an extension bundle loaded outside a browser degrades by omitting capabilities, never by crashing on a missing API.
