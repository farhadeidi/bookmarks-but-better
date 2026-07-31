# `bbb` — the daemon, HTTP API and CLI

Serves a Markdown vault over loopback HTTP, and optionally the built web UI
alongside it. The on-disk format lives entirely in
[`bbb-vault-core`](../bbb-vault-core); this crate adds behaviour — locking,
mutation, watching, and the HTTP contract.

## Commands

```sh
bbb init   --vault <path>                 # write the root .bbb-folder.md and .bbb-state.json
bbb doctor --vault <path>                 # read-only report; non-zero if unhealthy
bbb rescan --vault <path>                 # offline rescan and summary
bbb serve  --vault <path> \
           [--bind 127.0.0.1] [--port 52222] \
           [--ui-dir <path>] [--init]
bbb setup                                 # guided first run: vault, port, next steps
bbb service install --vault <path> [--port 52222] [--ui-dir <path>] [--no-start]
bbb service start | stop | status | uninstall
```

Every command names its vault explicitly. There is no discovery and no default
path: the only directory `bbb` reads, writes or watches is the one on the
command line. That includes `service install`, whose definition embeds the exact
path it was given — which is why `serve` still has no vault discovery to fall
back on.

`serve` refuses a directory that is not already a vault and prints the two ways
to fix it. `--init` is the opt-in that lets `serve` write the root metadata file
itself — convenient for tests and first runs, never implicit.

## The background service

`bbb service install` writes a **user-level** definition — no administrator, no
`sudo`, nothing outside your own home directory:

| Platform | What is written                                   | Where                                       |
| -------- | ------------------------------------------------- | ------------------------------------------- |
| Linux    | systemd **user** unit (`systemctl --user`)         | `$XDG_CONFIG_HOME/systemd/user/bbb.service` |
| Linux¹   | XDG autostart entry, the fallback                  | `$XDG_CONFIG_HOME/autostart/bbb.desktop`    |
| macOS    | `LaunchAgent`                                      | `~/Library/LaunchAgents/com.bookmarksbutbetter.bbb.plist` |
| Windows  | Scheduled Task, triggered at logon                 | registered from `$XDG_CONFIG_HOME/bbb/bbb-task.xml` |

¹ Used only when there is no usable `systemctl --user`. An autostart entry is
started once at login and nothing supervises it, so there is no restart on
failure — `bbb service status` says so rather than implying otherwise.

Properties that hold on every platform:

- **Loopback only.** The definition cannot be built with a non-loopback bind.
- **Restart on failure**, where the platform supports it — never on a clean
  exit, so `bbb service stop` is a command rather than a fight.
- **Idempotent.** Installing what is already installed writes nothing.
- **An explicit port survives an upgrade.** `install` with no `--port` reads the
  installed definition's own command line and keeps its port, so an
  installation configured on the previous default (47321) is not moved.
- **Uninstall never deletes your vault.** It removes one generated file.
- **No bookmark content in logs.** A definition is a command line and a log
  level; the daemon logs counts, identities, codes and paths only.

### Status of the platform integration

Writing the definition is implemented and tested for all four formats on every
platform. *Driving* the platform's service manager — start, stop, status — is
wired for systemd (`systemctl --user`), macOS (`launchctl bootstrap`/`bootout`
against the `gui/$UID` domain) and Windows (`schtasks /Create`, `/Run`, `/End`,
`/Delete`, `/Query`). Every operation is idempotent and user-level: no `sudo`,
no administrator prompt, no privilege beyond the account already running
`bbb`.

Only the Linux XDG-autostart fallback stays unwired, and by design rather than
by omission: an autostart entry is started once at login by the desktop
session, with no supervisor to ask about it afterward, so there is nothing for
`bbb service start`/`stop`/`status` to drive. `bbb service install` says so
plainly rather than reporting a success that did not happen.

## HTTP contract

Everything lives under `/api/v1`. Errors are
[`application/problem+json`](https://www.rfc-editor.org/rfc/rfc9457) with a
stable `code`.

| Method   | Path                     | Notes                                            |
| -------- | ------------------------ | ------------------------------------------------ |
| `GET`    | `/health`                | `{status, version, generation, warnings}`        |
| `GET`    | `/tree`                  | `{tree: [root]}` — one root holding the subtree   |
| `GET`    | `/bookmarks/{id}`        | one entry                                         |
| `POST`   | `/bookmarks`             | `{parentId, title, url?, index?, parentStateRevision?}`; no `url` ⇒ folder |
| `PATCH`  | `/bookmarks/{id}`        | `{revision, title?, url?}`                        |
| `DELETE` | `/bookmarks/{id}`        | `?revision=…[&parentStateRevision=…]`             |
| `POST`   | `/bookmarks/{id}/move`   | `{revision, parentId, index?, sourceStateRevision?, destinationStateRevision?}` |
| `POST`   | `/folders`               | `{parentId, title, index?, parentStateRevision?}` |
| `DELETE` | `/folders/{id}`          | `?revision=…[&parentStateRevision=…][&recursive=true]`; see below |
| `PUT`    | `/folders/{id}/order`    | `{stateRevision?, children:[{id, kind}]}`; see below |
| `POST`   | `/rescan`                | `{generation, changed, warnings}`                 |
| `GET`    | `/events`                | SSE; `changed` events carrying `{"generation":N}` |

### Entry shape

```jsonc
{
  "id": "a1b2c3d4",           // 8 base-36 chars, or "!path" for an identity-less directory
  "title": "React",
  "url": "https://react.dev", // bookmarks only
  "parentId": "k3f9a2p1",     // absent on the root
  "children": [],             // folders only
  "dateAdded": 1767225600000, // epoch milliseconds, parsed from bbb_created
  "revision": "9f2c…",        // send this back with the next mutation
  "stateRevision": "4b7e…",   // folders only; send back with anything that changes what it holds
  "orderReadOnly": true,      // folders only; present when the order cannot be rewritten
  "readOnly": true,           // present only when the entry must not be written
  "diagnostics": [ … ]        // present only when there is something to say
}
```

### Error codes

| Code                | Status | Meaning                                        |
| ------------------- | ------ | ---------------------------------------------- |
| `invalid_request`   | 400    | malformed id, revision, body or query           |
| `host_not_allowed`  | 403    | the `Host` header is missing or not loopback    |
| `not_found`         | 404    | no entry with that address                      |
| `route_not_found`   | 404    | no such route                                   |
| `stale_revision`    | 409    | the file changed on disk; reload and reapply    |
| `folder_not_empty`  | 409    | retry with `recursive=true`                     |
| `ambiguous_id`      | 409    | more than one entry claims the identity         |
| `subtree_has_unknown_files` | 409 | the folder holds files bbb does not manage |
| `subtree_changed`   | 409    | the subtree changed while the delete was planned |
| `read_only`         | 422    | the entry has an error diagnostic, or no identity |
| `invalid_value`     | 422    | the value cannot be stored in the format        |
| `move_into_self`    | 422    | a folder cannot contain itself                  |
| `stale_state_revision` | 409 | the folder's child order changed; reload and retry |
| `invalid_order`     | 422    | the order is not a permutation, or an index is past the end |
| `state_read_only`   | 422    | the folder's `.bbb-state.json` must not be overwritten |
| `vault_unavailable` | 500    | the vault could not be read or written          |
| `partial_failure`   | 500    | a multi-step change failed and could not be undone |
| `unsupported_operation` | 501 | the platform lacks a primitive the operation needs |

### Ordering children

Each managed folder owns a `.bbb-state.json` recording the order its children
are in, bookmarks and sub-folders together. The filesystem stays authoritative
for *membership*; the file only ever says what order things are in.

`PUT /folders/{id}/order` takes the complete permutation — every direct child
that has a stable identity, exactly once, with the right `kind` — rather than a
patch, because a partial order has no single correct completion. Sending the
order a folder is already in writes nothing, changes no revision, and produces
no event.

`index` on a create or a move counts the children exactly as `GET /tree` gives
them, from zero; the end when omitted.

`stateRevision` is required only where it means something. A request that says
*where* — an `index`, or a `PUT .../order` — is checked against the revision it
names, and refused with `stale_state_revision` if it does not send one, because
a position only means something against a particular arrangement. A request
that appends or removes by identity means the same thing whatever order the
folder is in, so it may leave the revision out and the daemon resolves the
current one itself under the write gate; a client written before ordering
existed therefore keeps working unchanged. A revision that *is* sent is always
checked strictly.

A folder with no order file yet — one made before this feature, or in a file
manager — is shown in the deterministic *migration order*: folders first, then
by `bbb_created` and stable identity, and finally any directory with no
`.bbb-folder.md`. It gains a real order file the first time a change needs one,
pinning what was already on screen. That first write is a real change and does
advance the revision; every later request for an order the folder already has
writes nothing.

**Migration note.** Before this feature siblings were sorted by folded title.
They are now sorted as above, so an existing vault's default order changes once,
the first time it is scanned by this build. Nothing on disk is rewritten to
achieve it, and `bbb init` on an existing vault pins whatever order is being
shown at that moment.

A directory with no `.bbb-folder.md` has no stable identity, so no order file
can name it and nothing can move it. Those sit in a block at the end whose
position never changes — managed entries reorder above them — and an `index`
that would fall after one is refused with `invalid_order` rather than quietly
landing somewhere else.

A file this build cannot fully account for (an unknown key, one identity listed
twice, an unreadable document, a version from the future, or a name held by a
directory, a link or a case-variant sibling) is **never rewritten**.
Where it can still be read it is still honoured for ordering; positional
requests against it return `state_read_only`, and creating, renaming, moving and
deleting all keep working. `bbb doctor` names every folder in that state.

### Deleting a folder

`recursive=true` deletes a subtree only when every file in it is one the vault
manages — a `.bbb-folder.md`, a scanned bookmark, or a file inside a scanned
bookmark's `.assets` directory, a nested `.bbb-folder.md` or a nested
`.bbb-state.json` — and every one of those files still holds the bytes the
request was planned against.

A stray `notes.txt`, an `.obsidian` directory, a symbolic link, or a bookmark an
editor touched a moment ago each stop the delete with a 409. There is no
override flag: the single revision a client can send covers the folder's own
metadata and says nothing about the thousand files beneath it, so it is not
permission to erase them. Remove the unmanaged parts in a file manager, where
you can see what you are losing, and then retry.

## Guarantees

- **One writer.** An advisory lock on `<vault>/.bbb/lock`, released by the
  operating system even if the process is killed.
- **No silent overwrites.** Every mutation carries a `revision`; a mismatch is a
  409 and the file is left alone.
- **No lost bytes.** Updates use the format core's surgical patching, then a
  uniquely named temporary file created with `create_new` in the destination
  directory, `fsync`, and a commit bound to the exact file that was validated.
  A no-op update writes nothing at all.
- **A commit cannot hit the wrong file.** On Linux the new file is swapped in
  with `renameat2(RENAME_EXCHANGE)` and the evicted file is then read back: if
  it is not the bytes that were validated, the swap is undone and the caller
  gets `stale_revision` with the other file untouched. Elsewhere the target is
  re-opened no-follow and its identity *and* contents are compared immediately
  before the rename.
- **Nothing is deleted in place.** Deletions rename entries into
  `<vault>/.bbb/staging` under a durable, two-phase manifest, and destroy them
  only after the phase flips to `committed`. Startup rolls back what never
  committed and finishes what did. Nothing is ever purged: anything that cannot
  be recovered is kept, listed in `.bbb/staging/recovery.txt`, and reported in
  `GET /health` and `bbb doctor`.
- **A staged entry is claimed only if it is still the entry that was verified.**
  Where the platform has an atomic exchange, a placeholder is swapped in so the
  original name is never free; the claim is then checked and reversed if it took
  the wrong thing. An entry replaced in between is returned untouched and the
  request fails with `stale_revision` or `subtree_changed`.
- **The manifest is treated as hostile.** Every origin component, entry name and
  staged name must be one plain, portable component; origins are resolved handle
  by handle beneath the vault, never joined into a path. A manifest that fails
  any of that is never acted on — its directory is left exactly as found and
  reported.
- **An undo that fails never deletes anything.** The temporary then holds the
  user's evicted bytes, so it is moved into staging under a manifest that says
  where it belongs. Recovery tries to restore it at the next start; if the
  destination is occupied, the bytes remain staged and `bbb doctor` explains
  how to recover them.
- **No clobbering.** Creates use `create_new`; file moves claim the destination
  name first and rename over their own placeholder; directory moves use a real
  no-replace rename, and a platform without one refuses the move rather than
  probing and hoping.
- **Stable identities.** Identity lives in front matter, so it survives moves,
  renames and restarts.
- **Loopback only.** The bind address is loopback and the `Host` header is
  checked, which is what stops DNS rebinding from reaching the daemon.
- **Nothing outside the vault.** Every read, write and rename resolves through
  an `openat`-style directory handle with `O_NOFOLLOW`, so no path is resolved
  twice and a symbolic link swapped in mid-operation fails it rather than
  redirecting it. `.bbb` is refused if it is not a real directory. The static
  UI refuses symlinked files outright, including ones pointing inside
  `--ui-dir`.
- **Logs carry no bookmark content** — counts, identities, codes and paths only.

### One thing that does leave the machine: favicons

Every guarantee above is about `bbb` itself, and each one still holds: the
daemon binds loopback, checks `Host`, and makes no outbound request of any kind.

The **web UI it serves** is a different matter. Bookmark icons are fetched from
Google's public favicon service (`t1.gstatic.com/faviconV2`). That *primary*
provider is shared by every build; only the fallback differs, and daemon mode
takes standalone's rather than either extension's:

| Build      | Primary                    | Fallback, when the primary returns no icon               |
| ---------- | -------------------------- | -------------------------------------------------------- |
| Daemon     | `t1.gstatic.com/faviconV2` | `www.google.com/s2/favicons`                             |
| Standalone | `t1.gstatic.com/faviconV2` | `www.google.com/s2/favicons`                             |
| Chrome     | `t1.gstatic.com/faviconV2` | the extension's own `_favicon` API — stays on the device |
| Firefox    | `t1.gstatic.com/faviconV2` | none; Firefox has no `_favicon` equivalent               |

So daemon mode matches **standalone**, not the extension builds. The distinction
matters for exactly the reason this section exists: Chrome's second attempt never
leaves the machine and Firefox makes no second attempt at all, whereas daemon
mode's goes to Google too.

Rendering a bookmark therefore sends its *origin* to Google, and the set of
origins one client asks for is, in aggregate, that user's bookmark host list.
Paths are never sent — only the scheme and host.

This is a deliberate trade-off, not an oversight. Daemon mode previously drew a
generated letter-avatar instead and disclosed nothing, at the cost of showing a
placeholder for every bookmark. Restoring that property properly means a
daemon-side proxy that fetches each site's own icon and caches it, which would
make `bbb` talk to non-loopback hosts for the first time and needs the SSRF
hardening that implies. Until then, `--ui-dir` is the switch: a daemon serving
no UI makes and causes no such request.

## Platform behaviour

Everything above holds on every platform except where this table says otherwise.

| Operation | Linux | macOS | Windows | Other |
| --------- | ----- | ----- | ------- | ----- |
| Durable replacement | `fsync` + rename + dir `fsync` | same | `MoveFileExW(REPLACE_EXISTING \| WRITE_THROUGH)`; no directory `fsync` exists | rename + dir `fsync` |
| Commit binding | `renameat2(RENAME_EXCHANGE)` then verify — no window | re-open, compare identity + content, rename | same as macOS | same, identity unavailable, content only |
| File identity | inode | inode | `GetFileInformationByHandle` | none; content comparison only |
| Directory move | `renameat2(RENAME_NOREPLACE)` | `renameatx_np(RENAME_EXCL)` | `MoveFileExW` without `REPLACE_EXISTING` | **refused**, `501 unsupported_operation` |

`cfg` is keyed on `target_os = "macos"`, not on the Apple vendor: iOS and the
rest are not targets here and would not have been tested.
| Symlink refusal | `O_NOFOLLOW` | `O_NOFOLLOW` | reparse-point equivalent | as the platform allows |

The one place `unsafe` appears in this crate is `src/fsx/platform.rs`, which
holds every FFI call; the crate denies it everywhere else.

## Testing

```sh
cargo test -p bbb
# the cfg(windows) code, checked from any host:
rustup target add x86_64-pc-windows-msvc
cargo check --workspace --all-targets --target x86_64-pc-windows-msvc
```

`bbb doctor` reports a staging directory only when recovery marked it retained
or its manifest is unusable; an operation a running daemon is in the middle of
is not a fault, and is passed over.

Races are tested by interposing at the instant between recording an entry and
claiming it — replacing the file or directory exactly there — and asserting the
replacement survives and the request is refused. Crash recovery is tested by
arming a fault at each stage transition — before
the first rename, between renames, either side of the phase flip, and part-way
through destroying — letting the real staging code die there, and then running
recovery against whatever it left on disk.
