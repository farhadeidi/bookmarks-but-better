# `bbb` — the daemon, HTTP API and CLI

Serves a Markdown vault over loopback HTTP, and optionally the built web UI
alongside it. The on-disk format lives entirely in
[`bbb-vault-core`](../bbb-vault-core); this crate adds behaviour — locking,
mutation, watching, and the HTTP contract.

## Commands

```sh
bbb init   --vault <path>                 # write the root .bbb-folder.md
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
| `POST`   | `/bookmarks`             | `{parentId, title, url?}`; no `url` ⇒ folder      |
| `PATCH`  | `/bookmarks/{id}`        | `{revision, title?, url?}`                        |
| `DELETE` | `/bookmarks/{id}`        | `?revision=…`                                     |
| `POST`   | `/bookmarks/{id}/move`   | `{revision, parentId}`                            |
| `POST`   | `/folders`               | `{parentId, title}`                               |
| `DELETE` | `/folders/{id}`          | `?revision=…[&recursive=true]`; see below          |
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
| `vault_unavailable` | 500    | the vault could not be read or written          |
| `partial_failure`   | 500    | a multi-step change failed and could not be undone |

### Deleting a folder

`recursive=true` deletes a subtree only when every file in it is one the vault
manages — a `.bbb-folder.md`, a scanned bookmark, or a file inside a scanned
bookmark's `.assets` directory — and every one of those bookmarks still holds
the bytes the request was planned against.

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
  directory, `fsync`, rename, and a directory `fsync` on Unix. On Windows the
  rename lands on `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`, which is atomic on
  one volume; there is no portable directory `fsync`, which is why the
  durability guarantee is "best available" rather than identical everywhere. A
  no-op update writes nothing at all.
- **Nothing is deleted in place.** Deletions rename entries into
  `<vault>/.bbb/staging` first and destroy them only once every entry has
  moved, so a failure part-way is rolled back and a crash leaves bytes in a
  directory the scanner ignores — purged by the next daemon to take the lock.
- **No clobbering.** Creates use `create_new`; moves claim the destination name
  first (`renameat2(RENAME_NOREPLACE)` on Linux), so a rename can never destroy
  a file that is already there.
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

## Testing

```sh
cargo test -p bbb
```
