# bbb-vault-core

The canonical on-disk vault format for **Bookmarks But Better**.

This crate owns the format and nothing else — no HTTP, no CLI, no watcher, no
services. It parses, validates, scans and *surgically updates* a directory tree
of Markdown files that stays fully usable in a text editor, in Obsidian and in
Git.

## The format

```
vault/
  .bbb-folder.md                    # stable identity of this directory
  React--a1b2c3d4.md                # <sanitized title>--<immutable id>.md
  React--a1b2c3d4.assets/logo.svg   # user-supplied assets, colocated
  Reading list/
    .bbb-folder.md
    The Rust Book--r1r2r3r4.md
  README.md                         # an ordinary note; left completely alone
```

```yaml
---
bbb_id: a1b2c3d4                    # required, immutable
bbb_url: https://react.dev          # required
bbb_title: React                    # required
bbb_created: 2026-01-01T09:00:00Z   # required, RFC 3339
bbb_updated: 2026-01-02T10:30:00Z   # required, RFC 3339
bbb_logo: React--a1b2c3d4.assets/logo.svg   # optional
tags: [frontend, library]           # unknown keys are user data
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

## Dependencies

None. Everything the format needs — a line-oriented front matter scanner that
records byte ranges, a content fingerprint, and a symlink-free directory walk —
needs exact control over bytes and is covered by golden tests under `tests/`.

## Known limitations

* Sibling ordering is case-folded code point order, not locale collation, so
  `Éclair` sorts after `Zebra`. The requirement is determinism, and full Unicode
  collation would need a collation table.
* Name comparison folds case but does not normalize Unicode composition, so
  precomposed and decomposed forms of the same name are treated as distinct.
* Front matter must be delimited by `---`; the alternative `...` terminator is
  not recognised.
