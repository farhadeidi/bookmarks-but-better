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
| `DELETE` | `/folders/{id}`          | `?revision=…[&recursive=true]`                    |
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
| `read_only`         | 422    | the entry has an error diagnostic, or no identity |
| `invalid_value`     | 422    | the value cannot be stored in the format        |
| `move_into_self`    | 422    | a folder cannot contain itself                  |
| `vault_unavailable` | 500    | the vault could not be read or written          |

## Guarantees

- **One writer.** An advisory lock on `<vault>/.bbb/lock`, released by the
  operating system even if the process is killed.
- **No silent overwrites.** Every mutation carries a `revision`; a mismatch is a
  409 and the file is left alone.
- **No lost bytes.** Updates use the format core's surgical patching, then a
  temporary file in the destination directory, `fsync`, rename, and a directory
  `fsync` where the platform supports it. A no-op update writes nothing at all.
- **Stable identities.** Identity lives in front matter, so it survives moves,
  renames and restarts.
- **Loopback only.** The bind address is loopback and the `Host` header is
  checked, which is what stops DNS rebinding from reaching the daemon.
- **Nothing outside the vault.** No symlinks are followed, by the scanner or by
  the watcher.
- **Logs carry no bookmark content** — counts, identities, codes and paths only.

## Testing

```sh
cargo test -p bbb
```
