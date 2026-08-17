# Bookmark Sources

The product presents bookmarks from independently configured sources. This language distinguishes source availability from the source currently shown to the user.

## Language

**Bookmark Source**:
A distinct collection of bookmarks that can be made available in a browser profile. Sources remain separate and are never implicitly merged.
_Avoid_: Mode, backend, adapter

**Browser Source**:
The bookmark source owned by the current browser profile.
_Avoid_: Local bookmarks, native mode

**Vault**:
An independently identified collection of bookmarks managed by a daemon. Vaults remain separate even when the same daemon exposes them.
_Avoid_: Directory, daemon, workspace

**Daemon Source**:
The bookmark source corresponding to exactly one Vault exposed by a connected daemon.
_Avoid_: Remote bookmarks, vault mode

**Daemon**:
An independent local authority over one or more Vaults. It exposes them to clients and does not depend on a user interface to run.
_Avoid_: Daemon mode, daemon UI

**Daemon Connection**:
A client's relationship with one daemon. A connection can make multiple Daemon Sources available without combining their bookmarks.
_Avoid_: Daemon Source, Active Source

**Client**:
A user-facing application that reads and changes bookmarks through a source. The browser extension and the daemon web app are separate clients.
_Avoid_: Source, daemon

**Daemon Web App**:
A client for the Daemon Sources exposed by its daemon. It may be served alongside the daemon interface, but remains optional.
_Avoid_: Daemon, Daemon Source

**Enabled Source**:
A bookmark source the user has made available in the current browser profile. More than one source can be enabled at once.
_Avoid_: Active mode, connected source

**Active Source**:
The single enabled source currently shown and affected by bookmark operations. Changing the active source does not merge or move bookmarks.
_Avoid_: Enabled source, selected mode

**Standalone Source**:
The legacy browser-local bookmark source that is being retired. Existing profiles that were actively using it keep access during the sunset period (removal lands in the next major version); new users cannot select it, and migration to a Browser Source or a Daemon Source is an explicit copy that leaves the legacy data intact.
_Avoid_: Browser Source

**Source Configuration**:
The set of enabled sources and the active source for one browser profile. It is not shared with other browser profiles.
_Avoid_: Global mode, synced mode

**Source Session**:
The period during which one Active Source backs every bookmark operation in a client. Switching sources ends the previous session — disposing its listeners and change stream, expiring its in-flight work, closing node-bound UI — and initializes a new one against the new source's adapter.
_Avoid_: Adapter swap, live mode change

**Platform Capabilities**:
What a given build and runtime can do — whether a Browser Source, daemon connections, or the omnibox integration exist. Product code asks these questions instead of naming a browser, so unsupported capabilities are omitted rather than branched around.
_Avoid_: Browser detection, Safari mode
