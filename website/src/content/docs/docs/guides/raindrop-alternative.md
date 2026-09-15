---
title: "A Raindrop alternative that needs no account"
description: "A factual Raindrop alternative comparison: cloud account vs local bookmarks, where your data lives, supported platforms, and importing a Raindrop CSV or HTML."
sidebar:
  label: Raindrop alternative
  order: 2
---

Raindrop.io and Bookmarks But Better both organize bookmarks, but they are built on different ideas. Raindrop is a cloud service you sign in to, with apps on many devices. Bookmarks But Better is a browser extension with no account that keeps bookmarks in your browser or in Markdown files on your own disk. This guide compares the two factually so you can decide which fits, and shows how to bring a Raindrop export across.

Facts about Raindrop.io below come from Raindrop's own pages, as of September 2026, and are linked where they are used.

## The short version

| | Raindrop.io | Bookmarks But Better |
| --- | --- | --- |
| Account | Sign in with email or username and password, Google, or Apple ([Raindrop help](https://help.raindrop.io/authentication)) | None |
| Where bookmarks live | Raindrop describes a "100% cloud-based architecture" ([raindrop.io](https://raindrop.io/)) | Your browser's bookmark store, or Markdown files in a folder you choose |
| Across devices | "Access your bookmarks seamlessly across all your devices" ([raindrop.io](https://raindrop.io/)) | No built-in sync; a vault folder can be carried by a file sync tool you already use |
| Platforms | Extensions for Chrome, Firefox, Safari and Edge; apps for Windows, Mac, iPad, iPhone and Android ([raindrop.io](https://raindrop.io/)) | Extensions for Chrome and Firefox; Safari coming soon (build it from source today), using a local daemon; daemon for macOS, Linux and Windows; no phone apps |
| Plans | A free plan and a paid Pro plan ([Raindrop plans](https://raindrop.io/pro/buy)) | Free and open source (MIT) |
| Export | HTML, CSV and TXT ([Raindrop help](https://help.raindrop.io/export-backup)) | HTML bookmarks file; vault bookmarks are already plain files |

## Account and cloud vs local

Raindrop is an online service: you sign in, and your collections are stored by Raindrop and reachable from its apps and extensions. That is what makes Raindrop's cross-device access work. Raindrop says it keeps "your data safe, never sold" and has "no ads & trackers" ([raindrop.io](https://raindrop.io/)).

Bookmarks But Better has no server and no account. Your bookmarks come from one of these sources:

- **Browser bookmarks.** The bookmarks already in Chrome or Firefox, read and edited through the browser's own bookmark APIs. Nothing is copied anywhere else.
- **Markdown vaults.** Folders of Markdown files on your disk, served to the extension by a small daemon that only listens on `127.0.0.1`/`localhost`.

Sources are never merged. You switch between them from the header, and every edit, import or delete affects only the source you are looking at. The [sources overview](/docs/start/sources/) explains this in detail.

The trade-off is plain. With a local tool, nobody else holds your bookmarks, and nobody else carries them between your devices either. The [no-account guide](/docs/guides/bookmark-manager-without-account/) goes through that trade-off.

## Features

Raindrop's free plan lists unlimited bookmarks, collections, highlights and devices, plus import and export. Its Pro plan adds features such as full-text search, a web archive, reminders, annotations, a duplicate and broken link finder, and daily backups ([Raindrop plans](https://raindrop.io/pro/buy)).

Bookmarks But Better covers a narrower job, and does it on the page you open most often:

- **A dashboard on every new tab.** Folders appear as cards in a masonry grid, each shown as a list or an icon grid.
- **A Bookmark Organizer.** A tree editor for dragging, reordering, renaming, creating and deleting bookmarks and folders.
- **Search.** Start typing anywhere on the dashboard to search titles, URLs and folder names, or type `bb` in the address bar.
- **Quick capture.** The toolbar popup saves the current page to the active source.
- **Ten color themes** with light, dark and system modes, plus a root folder you choose from the header.

It has no highlights, no page archive, no full-text search of page contents, no sharing, and no phone apps. If you rely on those, Raindrop is built for them.

## Where your data lives, concretely

In Bookmarks But Better:

- **Browser source:** bookmarks stay in the browser's own bookmark store.
- **Vault:** each bookmark is one Markdown file named after its title (for example `React--a1b2c3d4.md`). The URL, title and timestamps are stored in YAML front matter, and each folder on disk is a bookmark folder. You can read, copy, back up or version these files with ordinary tools.

The extension makes one kind of outside request by default: site icon lookups, which send a bookmark's origin (such as `https://example.com`, never the full path) to Google's favicon service, unless a local cache or the browser's own icon store answers first. The [privacy page](/privacy/) has the details.

## Moving from Raindrop

Raindrop can export HTML, CSV or TXT ([Raindrop help](https://help.raindrop.io/export-backup)). Bookmarks But Better imports the first two.

1. In Raindrop, export the collections you want as **CSV** or **HTML**.
2. In Bookmarks But Better, switch to the source the bookmarks should live in.
3. Open **Settings → Data & Migration → Import** and choose the file.
4. Review the preview, choose a destination folder, resolve any conflicts, and import.

**CSV.** The importer recognizes a Raindrop CSV by its `folder` column. A folder path such as `Parent/Child` becomes nested folders. It keeps each bookmark's title, URL and folder. Tags, notes, excerpts and dates are not imported, and rows without a valid `http`/`https` URL are skipped and counted in the preview.

**HTML.** A standard bookmarks HTML file is imported with its nested folders.

CSV keeps your collection structure through the `folder` column. Either format works for the links themselves. See [import and export](/docs/start/import-export/) for the full steps.

## Which one fits

Raindrop is likely the better choice if you want highlights, a web archive, sharing, phone apps, or bookmarks that follow you across devices without setting anything up.

Bookmarks But Better is likely the better choice if you want no account, bookmarks that stay in your browser or in Markdown files you own, and a clean dashboard every time you open a new tab.

## Get started

- Install for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website).
- Try the [live preview](/preview/) with demo bookmarks, no install needed.
- Want bookmarks as files? Read about [Markdown vaults](/docs/daemon/).
