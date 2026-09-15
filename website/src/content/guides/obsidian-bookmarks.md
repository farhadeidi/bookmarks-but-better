---
title: "Obsidian bookmarks as Markdown files"
description: "Keep bookmarks as Markdown files in or next to your Obsidian vault, shown on your browser's new tab. What the files look like and how to set it up safely."
publishedAt: 2026-09-15
---

Bookmarks But Better can keep your bookmarks as plain Markdown files, one file per bookmark and one folder per bookmark folder, and show them on your browser's new tab page. Because they are ordinary Markdown files with YAML front matter, Obsidian can open them. The simplest setup is a dedicated bookmarks folder, either next to your Obsidian vault or as a subfolder inside it. Pointing it at the root of an existing Obsidian vault technically works, but you probably won't like the result. Details below.

## How it works

The browser extension replaces the new tab page with a bookmarks dashboard. By default it shows your browser's bookmarks. It can also connect to the **daemon**, a small local program that serves bookmarks from a folder of Markdown files, called a **vault**, over `127.0.0.1` only.

The daemon reads the files, and the extension displays and edits them through it. Edits made in the dashboard are written back to the files. Edits made in another app, such as Obsidian, are picked up: the daemon watches the folder, rescans after changes, and also rescans on a timer in case a change notification is missed.

Two terms, since both products use them: an **Obsidian vault** is the folder Obsidian opens. A **bookmarks vault** is the folder the daemon serves. They can be the same folder, but they don't have to be.

## What a bookmarks vault looks like

```text
Bookmarks/
  .bookmarks-but-better-folder.md    identity of this folder
  .bookmarks-but-better-state.json   the order of its children
  React--a1b2c3d4.md                 one bookmark
  Reading list/
    .bookmarks-but-better-folder.md
    .bookmarks-but-better-state.json
    The Rust Book--r1r2r3r4.md
```

Each bookmark file is named after its title followed by `--` and an eight-character id (`React--a1b2c3d4.md`), and its front matter holds the data:

```yaml
---
bookmarks_but_better_id: a1b2c3d4
bookmarks_but_better_url: https://react.dev
bookmarks_but_better_title: React
bookmarks_but_better_created: 2026-01-01T09:00:00Z
bookmarks_but_better_updated: 2026-01-02T10:30:00Z
tags: [frontend, library]
---
Why I saved this…
```

Some details matter if you edit these files yourself:

- **Your own content is kept.** Only the `bookmarks_but_better_` keys belong to the daemon. Other properties such as `tags`, comments, key order and the whole note body below the front matter stay untouched, byte for byte, when the dashboard edits a bookmark.
- **Identity lives in the front matter, not the path.** You can move a bookmark file to another folder and it keeps its identity. The `--a1b2c3d4` part of the filename is meant to stay fixed; the title part can change.
- **The state file only stores order.** What a folder contains is whatever is in the directory. The `.json` file only records the order shown on the dashboard.
- **Conflicting edits are refused, not overwritten.** Every write checks that the file still has the content the dashboard last saw. If you changed it in Obsidian in the meantime, the dashboard gets a conflict instead of replacing your edit.
- **The daemon keeps its own working directory.** While running, it keeps a lock file and staging area in a `.bookmarks-but-better/` directory at the vault root.

## What Obsidian shows you

Obsidian [stores notes as Markdown files in a folder](https://obsidian.md/help/data-storage) and displays YAML front matter as [properties](https://obsidian.md/help/properties). So each bookmark shows up as a note titled like `React--a1b2c3d4`, with the URL, title and timestamps as properties. Anything you write below the front matter is a normal note body. Obsidian also says it [refreshes the vault when other apps change files](https://obsidian.md/help/data-storage), so bookmarks saved from the browser appear in Obsidian as new notes.

The folder and state files start with a dot. Obsidian's help notes that [most operating systems hide folders starting with a period](https://obsidian.md/help/data-storage). How Obsidian itself lists dot-files isn't covered by its help pages, so check your own setup rather than assume.

## Can a bookmarks vault live inside an Obsidian vault?

Yes, with a few things worth knowing.

**What the daemon ignores.** When scanning, it skips directories whose names start with a dot (such as `.obsidian`), files that aren't Markdown, and Markdown files that have no `bookmarks_but_better_id` in their front matter. Your ordinary notes are passed over silently: they don't show up as bookmarks and aren't reported as errors.

**What setup writes.** Initializing a folder as a bookmarks vault writes exactly two files into that folder: `.bookmarks-but-better-folder.md` and `.bookmarks-but-better-state.json`. It doesn't go into subfolders. When the daemon runs, it also creates its `.bookmarks-but-better/` directory there. Nothing else in your notes is rewritten.

**Why not the Obsidian vault root.** Every non-hidden subfolder of a bookmarks vault appears on the dashboard as a bookmark folder. Folders that weren't created as bookmark folders have no identity file yet. They are shown read-only, with a diagnostic, until something gives them one, though bookmarks inside them stay editable. Pointed at the root of a large notes vault, the dashboard would fill up with your note folders, most of them containing no bookmarks.

**Deleting folders is conservative.** Deleting a folder from the dashboard only removes it if every file inside is one the vault manages. A stray note, a `.obsidian` directory or a symbolic link stops the delete, so you can decide in a file manager what to remove.

**Recommended layout:**

```text
My Notes/            Obsidian vault
  .obsidian/
  Daily/
  Projects/
  Bookmarks/         bookmarks vault: point the daemon here
```

**Several bookmarks vaults.** One daemon can serve several vaults, each shown as its own source in the extension, never merged. Their folders must not overlap: one bookmarks vault can't sit inside another, and the daemon refuses to start with such a setup. This rule is about bookmarks vaults only; your Obsidian vault isn't one. See [multiple vaults](/docs/daemon/multiple-vaults/).

## Setting it up

1. Install the extension for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website).
2. In a terminal, run `npx bookmarks-but-better@latest`. It installs the daemon, asks where your bookmarks should live (give it your `Bookmarks` folder), and starts it as a background service. Without Node.js, use the install scripts in [install the daemon](/docs/daemon/install/).
3. In the extension, open **Settings → Sources**, enter `127.0.0.1:52222` and click **Connect**. The browser asks for localhost permission at that moment, not at install.

Full steps: [install the daemon](/docs/daemon/install/) and [connect the extension](/docs/daemon/connect/).

Your browser bookmarks stay where they are. The vault is a separate source, and nothing moves between the two unless you import or copy it yourself.

## Backups and sync

A bookmarks vault is a folder of text files, so the tools you already use for your notes work for it too: a copy, a Git repository, or a file sync service. Uninstalling the daemon never deletes a vault. Keep in mind that sync isn't a backup, since a deletion syncs like any other change. See [backing up a vault](/docs/daemon/backups/).

## Get started

- Try the dashboard in the [live preview](/preview/). It uses demo bookmarks, no install needed.
- Install for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website), then follow [install the daemon](/docs/daemon/install/).
