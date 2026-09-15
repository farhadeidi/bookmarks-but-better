---
title: "A bookmark manager without an account"
description: "When a bookmark manager without an account makes sense: what local means in practice, the exact network requests, and the trade-offs for sync and backup."
sidebar:
  label: Without an account
  order: 4
---

A bookmark manager without an account keeps your bookmarks on your own devices instead of on a company's server. Nobody else holds a copy, nothing needs a password, and there's no service that can shut down under you. The costs: no built-in sync between devices, and backups are up to you. This guide explains when that trade makes sense, and exactly what "local" means for Bookmarks But Better.

## When no account makes sense

It is a good fit if:

- **You use one computer most of the time**, or already keep bookmarks in one browser profile.
- **You'd rather not have your list of saved sites on someone else's server.** A bookmark list says a lot about work, health, money and interests.
- **You want files you own.** Plain files outlive any single app, and you can open them with ordinary tools.
- **You already sync files your own way**, and would rather reuse that than add another service.

It is a weaker fit if you want bookmarks on your phone, instant sync across many devices with no setup, or shared collections with other people. Account-based services are built for those.

## What "local" means here, concretely

Bookmarks But Better is a free and open source (MIT) extension for Chrome and Firefox, with Safari support through a local daemon. There is no sign-up, and nothing to log into. Bookmarks live in one of these places:

- **Browser source.** Your browser's own bookmark store. The extension reads and changes bookmarks only through the browser's built-in bookmark APIs.
- **Vault.** A folder of Markdown files on your disk. A small optional program, the daemon, serves the folder to the extension over `127.0.0.1`/`localhost` only. It binds to loopback and makes no outbound requests of its own.
- **Standalone source (legacy).** An older collection in the browser profile's local storage, which is being retired. Moving off it is an explicit copy that leaves the old data intact.

These sources are never merged. You switch between them in the header, and each operation affects only the active source. Settings and source choices are stored per browser profile and aren't synced anywhere. Details: [how sources work](/docs/start/sources/).

## The network requests, exactly

From the [privacy page](/privacy/):

1. **Favicon lookups, by default.** To show site icons, the extension first checks a local cache on your machine, then, in Chrome, the browser's own on-device icon store. Only if neither has the icon does it ask Google's public favicon service, sending the bookmark's **origin** (for example `https://example.com`), never the path, query or fragment. Grid tiles need larger icons than the browser stores, so they ask Google before the browser's store. Successful lookups are cached for 30 days, so a site is normally asked about about once a month. Firefox has no on-device icon store an extension may read, so it skips that step. A letter placeholder is drawn locally when nothing answers.
2. **Your own daemon, if you connect one.** The extension then talks to that loopback address. The permission is requested when you click Connect, never at install.

That's all. No accounts, analytics, tracking, advertising or collection of bookmark content. One honest caveat: taken together, the origins sent for icon lookups amount to a list of the sites you've bookmarked, which is why they're cached and limited to origins.

When the daemon serves its own web app in a browser tab (not the extension), that page can show Google's icons but can't cache them, so it fetches them again on each load.

## The trade-offs

### No built-in sync

Nothing carries your bookmarks between devices for you. Your options:

- **Browser source:** if your browser already syncs its bookmarks, the dashboard simply shows what the browser has. The extension adds no sync of its own.
- **Vault:** a vault is a normal folder, so any file sync tool you already trust can carry it to another machine, each running its own daemon. On Safari, setup suggests a synced folder such as iCloud Drive for this. As with any synced folder, avoid editing the same bookmark on two machines at the same moment.

### Sync is not a backup

A sync tool copies deletions and mistakes as faithfully as good changes. Keep a separate backup:

- **Vault:** the bookmarks are text files, so copy the folder, keep it in a Git repository, or include it in your regular backups. Uninstalling the daemon never deletes a vault. See [backing up a vault](/docs/daemon/backups/).
- **Any source:** **Settings → Data & Migration → Export** saves bookmarks as an HTML file that any browser can import.

### Nobody to recover it for you

Without an account, there's no "restore from the cloud". The upside is that nothing depends on a service staying online. The vault format is documented plain Markdown with YAML front matter, readable without this extension.

## How it compares to account-based tools

Account-based managers such as Raindrop.io offer cross-device access, mobile apps and extra features in exchange for storing your bookmarks on their service. If you're weighing that choice, the [Raindrop comparison](/docs/guides/raindrop-alternative/) sets out the differences using Raindrop's own pages. If you keep notes in Obsidian, the [Obsidian guide](/docs/guides/obsidian-bookmarks/) shows how a vault fits next to your notes.

## Getting set up

1. Install the extension. The browser source works immediately, with nothing else to install.
2. Optionally, run `npx bookmarks-but-better@latest` to install the daemon and choose a folder for a Markdown vault. See [Markdown vaults](/docs/daemon/).
3. Import from an HTML file, or a Raindrop or Pocket CSV, under **Settings → Data & Migration**.

## Get started

- Install for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website).
- Try the [live preview](/preview/) with demo bookmarks, no install needed.
- Read the [privacy page](/privacy/) for the full details.
