---
title: "A local-first bookmark manager, with no server to run"
description: "What local-first means for bookmarks, how a browser-only setup compares to self-hosting linkding or Karakeep, and what you trade away for having no server."
sidebar:
  label: Local-first
  order: 6
---

Most bookmark managers are websites. You sign in, your links sit on someone else's machine, and the tool stops working the day the company does. The usual escape is to self-host something like [linkding](https://linkding.link/) or [Karakeep](https://karakeep.app/), which puts you back in control and hands you a server to keep alive.

Bookmarks But Better takes the third route: no service and no server. The bookmarks stay in your browser's own bookmark store, or in a folder of Markdown files on your disk. This guide explains what that buys you, and what it costs.

## What local-first usually means

The term comes from Ink & Switch's 2019 essay [Local-first software](https://www.inkandswitch.com/local-first/), which sets out seven properties: fast, multi-device, offline, collaborative, long-lived, private and secure, and under the user's ultimate ownership and control.

Bookmarks But Better meets some of those and not others, so it is worth being precise:

- **Fast and offline.** The dashboard reads a local store. There is no network round trip between opening a tab and seeing your bookmarks, and no request to make before the page is useful.
- **Long-lived.** A vault is one Markdown file per bookmark with YAML front matter, in ordinary folders. If the project were abandoned tomorrow, `grep`, a text editor and a file manager would still open every one of them.
- **Private.** No account, no analytics, no telemetry, no bookmark-content collection. The only outside request the extension makes by default is a site icon lookup that sends a bookmark's origin such as `https://example.com`, never the full path.
- **Under your control.** You can copy, back up, version and delete the files yourself, with tools you already have.
- **Multi-device: partly.** The browser source rides your browser's own bookmark sync, which already works across your machines. A vault folder goes wherever you put it, including inside a folder your file sync tool already handles.
- **Collaborative: no.** There is no shared editing, no merge of two people's changes, and no conflict resolution. One person, their own machines.

## Compared with self-hosting

linkding and Karakeep are both good at what they do, and both of them are servers. Running one means a machine that stays on, a container to update, a database to back up, and a URL to reach from wherever you are.

| | Self-hosted (linkding, Karakeep) | Bookmarks But Better |
| --- | --- | --- |
| What you run | A server process and its database | Nothing, or one small local daemon if you want vaults |
| Reachable from | Anywhere you expose it to | The machine it runs on |
| Backups | Database dumps | Copy a folder, or commit it to git |
| Updates | Yours to apply | The browser updates the extension |
| Storage format | Application database | Markdown files, or the browser's bookmark store |
| Setup before first use | Install, configure, expose, secure | None |

The optional daemon is not a small self-hosted server in disguise. It binds to `127.0.0.1`/`localhost` and refuses connections from anywhere else, it has no accounts and no login, and it rebuilds its whole state by scanning the folder at every start. There is nothing in it to expose to a network, and nothing you would want to.

## Files over apps

Steph Ango's essay [File over app](https://stephango.com/file-over-app) makes the argument better than a feature list can: the file format outlives the program that made it, so the format is the part worth choosing carefully.

A vault is built that way. One bookmark is one file:

```yaml
---
bookmarks_but_better_id: a1b2c3d4
bookmarks_but_better_url: https://react.dev
bookmarks_but_better_title: React
bookmarks_but_better_created: 2026-01-01T09:00:00Z
bookmarks_but_better_updated: 2026-01-02T10:30:00Z
---
Why I saved this…
```

The file is named after the title plus a short id (`React--a1b2c3d4.md`). Only the `bookmarks_but_better_` keys belong to the daemon; your own properties and anything you write below the front matter are left alone.

Folders on disk are bookmark folders in the dashboard. Nothing is hidden in an index, so the same folder is readable by Obsidian, by git, by a backup tool, and by whatever you use in ten years. The [Obsidian guide](/docs/guides/obsidian-bookmarks/) covers keeping one in or beside a vault you already have, and [back up your vault](/docs/daemon/backups/) covers copying it safely.

## What you give up

- **No sync of its own.** Browser bookmarks sync with your browser. A vault syncs if you put it somewhere that syncs. There is no third option, and no way to reach your bookmarks from a machine you have not set up.
- **No phone.** There are no mobile apps.
- **No sharing.** No public collections, no team workspace, no share links.
- **No archiving.** It saves the link, not the page. There is no snapshot, no reader view and no full-text search of page contents.

The [no-account guide](/docs/guides/bookmark-manager-without-account/) goes through those trade-offs in more detail, including what to do about backups when nobody else is keeping a copy for you.

## Start without the local part

Worth saying plainly, because the phrase "local-first" makes people expect setup: you do not have to touch any of this. Install the extension, open a new tab, and it shows the bookmarks Chrome or Firefox already holds. Vaults, Markdown files and the daemon are there if you want them, and ignoring them costs you nothing.

## Get started

- Install for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website).
- Try the [live preview](/preview/) with demo bookmarks, no install needed.
- Ready for files on disk? [Install the daemon](/docs/daemon/install/).
