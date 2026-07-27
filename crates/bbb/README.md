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
           [--bind 127.0.0.1] [--port 47321] \
           [--ui-dir <path>] [--init]
```

Every command names its vault explicitly. There is no discovery and no default
path: the only directory `bbb` reads, writes or watches is the one on the
command line.

`serve` refuses a directory that is not already a vault and prints the two ways
to fix it. `--init` is the opt-in that lets `serve` write the root metadata file
itself — convenient for tests and first runs, never implicit.

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

`index` on a create or a move is a position among the folder's children,
counted from zero; the end when omitted. Anything that changes what a folder
holds carries that folder's `stateRevision`, so a stale client gets a 409
instead of dropping an entry into a list that has moved on.

A folder with no order file yet — one made before this feature, or in a file
manager — is shown in the deterministic *migration order*: folders first, then
by `bbb_created` and stable identity. It gains a real order file the first time
a change needs one, pinning what was already on screen.

A file this build cannot fully account for (an unknown key, one identity listed
twice, an unreadable document, a version from the future) is **never rewritten**.
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
