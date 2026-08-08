# bookmarks-but-better-vault-core

The canonical on-disk vault format for **Bookmarks But Better**.

This crate owns the format and nothing else — no HTTP, no CLI, no watcher, no
services. It parses, validates, scans and *surgically updates* a directory tree
of Markdown files that stays fully usable in a text editor, in Obsidian and in
Git.

## The format

```
vault/
  .bookmarks-but-better-folder.md    # stable identity of this directory
  .bookmarks-but-better-state.json   # the order this directory's children are in
  React--a1b2c3d4.md                 # <sanitized title>--<immutable id>.md
  React--a1b2c3d4.assets/logo.svg    # user-supplied assets, colocated
  Reading list/
    .bookmarks-but-better-folder.md
    .bookmarks-but-better-state.json
    The Rust Book--r1r2r3r4.md
  README.md                          # an ordinary note; left completely alone
```

```json
{
  "version": 1,
  "children": [
    { "id": "a1b2c3d4", "kind": "bookmark", "addedAt": "2026-01-01T09:00:00Z" }
  ]
}
```

Position in `children` *is* the order — folders and bookmarks interleave freely,
because a user who drags a bookmark above a sub-folder means exactly that.
Membership stays the filesystem's business: the file can never add a child that
is not there, and a child it does not mention still appears, appended after
everything it does name.

A folder with no order file is shown in the deterministic *migration order*:
folders first, then by `bookmarks_but_better_created` and stable identity, and last any directory
with no `.bookmarks-but-better-folder.md`. Those last ones have no identity for an order file to
name, so they form a trailing block whose position is the same before any order
file exists and after every rewrite — which is what lets an index into the list
mean the visual position it names. (Before this feature siblings were sorted by
folded title; an existing vault's default order therefore changes once, without
anything on disk being rewritten.)

A document this build cannot fully account for is never rewritten: an unknown
key, one identity listed twice, an unreadable file, a version from the future,
or the name being held by a directory, a link or a sibling differing only by
case. All of them leave what is there exactly as found and take away only the
ability to reorder — creating, renaming, moving and deleting keep working.
A duplicated JSON key is a hard parse error rather than a last-one-wins merge,
because two values for one key have no correct interpretation.

```yaml
---
bookmarks_but_better_id: a1b2c3d4                            # required, immutable
bookmarks_but_better_url: https://react.dev                  # required
bookmarks_but_better_title: React                            # required
bookmarks_but_better_created: 2026-01-01T09:00:00Z           # required, RFC 3339
bookmarks_but_better_updated: 2026-01-02T10:30:00Z           # required, RFC 3339
bookmarks_but_better_logo: React--a1b2c3d4.assets/logo.svg   # optional
tags: [frontend, library]                                    # unknown keys are user data
---
```

Identity lives in the front matter, never in the path, so it survives renames,
moves and title changes. The `--<id>` filename suffix is a convenience for
humans and for recovery.

## Byte preservation

Updates locate the byte range of an owned scalar value and splice new bytes into
the original file. The document is never deserialized and re-serialized, so:

* a no-op update is byte-identical to its input;
* unknown keys, key order, comments, quoting style, block scalars, the byte
  order mark, line endings and the Markdown body all survive every mutation;
* anything that cannot be updated safely — invalid UTF-8, unterminated front
  matter, a non-mapping root, duplicated owned keys, multiline or collection
  values for owned keys — is refused and surfaced as a read-only entry with an
  actionable diagnostic.

Writes are guarded by a content revision (a SHA-256 fingerprint of the exact
file bytes), so an external edit produces a conflict instead of a silent
overwrite.

## Safety of the traversal

"Do not follow symlinks" cannot be implemented by checking a path and then
opening it: between the check and the open, the name can be replaced with a
link. The walk therefore never names a path twice. It holds a directory handle
and resolves every child against that handle with the no-follow flag
(`cap-std`/`cap-fs-ext`, which use `openat`/`O_NOFOLLOW` on Unix and the
reparse-point equivalent on Windows). Sizes come from the open handle, and reads
are bounded by the handle rather than by a previously observed length.

A vault root that is itself a link is refused, and the refusal is race-free for
every root whose final component is a name — absolute, relative, or a bare
`vault` resolved against the working directory. The directory holding the name is
opened first, and the name is resolved against that handle with no-follow. A path
ending in `/`, `.` or `..` names no directory entry at all, so there is nothing to
substitute and it is opened directly.

## Dependencies

Each one replaces something that must not be hand-rolled.

| crate | why |
|---|---|
| `cap-std`, `cap-fs-ext` | capability-oriented handles; `std` cannot open a path without a check-then-use window |
| `sha2` | SHA-256 for content revisions |
| `getrandom` | operating-system randomness for identities |
| `unicode-normalization` | NFC for names on disk, NFD for caseless matching |
| `caseless` | Unicode full case folding (`ß` → `ss`), which `str::to_lowercase` does not do |
| `saphyr-parser` | an independent conformant YAML parser, used only to validate; it never writes |

## Known limitations

* Sibling ordering is canonical caseless fold order. It ignores case, folds
  `ß` to `ss`, and decomposes accents, so `Éclair` sorts between `apple` and
  `Zebra`. It is still not locale collation: there is no language tailoring, so
  a Swedish speaker's expectation that `ö` sorts after `z` is not met. The
  guarantee is that the order never changes between runs, platforms or
  spellings.
* Front matter must be delimited by `---`; the alternative `...` terminator is
  not recognised.
* On Windows, "not a link" means "not a reparse point" as `cap-primitives`
  implements it. That covers symlinks and directory junctions; exotic reparse
  tag types are refused conservatively rather than classified individually.
