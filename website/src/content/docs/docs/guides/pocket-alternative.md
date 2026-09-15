---
title: "A Pocket alternative for your saved links"
description: "Looking for a Pocket alternative? Import your Pocket CSV into a private new-tab bookmarks dashboard. What carries over, what doesn't, and no account needed."
sidebar:
  label: Pocket alternative
  order: 1
---

If you used Pocket mainly to keep links you wanted to find again, Bookmarks But Better can take over that job. It imports the CSV file from a Pocket export and shows those links on your new tab page, with no account. It is not a read-later app, though. It does not save article text, offer a reading view, or work offline with saved pages, so if that is what you miss, read the last section first.

## What happened to Pocket

Mozilla [announced on May 22, 2025](https://blog.mozilla.org/en/mozilla/building-whats-next/) that Pocket would shut down on July 8, 2025. Users could export their saves until October 8, 2025, after which Mozilla said the data would be permanently deleted.

That export deadline has passed. What follows only helps if you exported your saves before then and still have the file.

## What Bookmarks But Better is

Bookmarks But Better is a free and open source (MIT) browser extension for Chrome and Firefox. It replaces the new tab page with a bookmarks dashboard: your folders appear as cards in a grid, each showing its links as a list or as an icon grid.

Your bookmarks come from a **source**:

- **Browser bookmarks.** The bookmarks already in your browser, read and changed through the browser's built-in bookmark APIs.
- **A Markdown vault.** A folder of Markdown files on your own disk, served by an optional local program (the daemon) that only listens on `127.0.0.1`.

You can turn on either or both and switch between them from the header. Sources are never mixed together: an import, an edit or a delete only affects the source you are looking at. See [how sources work](/docs/start/sources/).

There is no account, no analytics and no collection of bookmark content. The [privacy page](/privacy/) lists the few network requests the extension makes.

## Importing your Pocket export

Import lives in the extension's **Settings → Data & Migration → Import**. It accepts a standard HTML bookmarks file or a CSV export from Raindrop or Pocket.

1. Pick the source you want the links to live in: browser bookmarks or a vault. The import goes into the active source only.
2. Open **Settings → Data & Migration** and choose your Pocket CSV file.
3. Check the preview, pick a destination folder, and optionally name a new subfolder to import into.
4. Confirm. If a bookmark with the same URL already exists in the destination folder, you choose whether to skip it, replace it or keep both.

How the importer reads a Pocket file:

- It spots a Pocket export from the header row: a `url` column together with `time_added` or `status`.
- Every link goes into one folder named **Pocket**, since a Pocket export has no folder structure to rebuild.
- It keeps each row's title and URL. When a title is empty, it uses the site's host name instead.
- It skips rows without a valid `http` or `https` URL and shows how many were skipped in the preview.

The full walkthrough, including HTML files from other browsers, is in [import and export](/docs/start/import-export/).

## What carries over and what doesn't

| From your Pocket export       | After import                                   |
| ----------------------------- | ---------------------------------------------- |
| Link URL                      | Kept                                           |
| Title                         | Kept (host name when empty)                    |
| Tags                          | Not imported                                   |
| Read / archived status        | Not imported                                   |
| Date added                    | Not imported                                   |
| Saved article text, highlights | Not available; the extension stores links only |

Once imported, the links are ordinary bookmarks. You can rename them, move them into folders with the Bookmark Organizer (a drag-and-drop tree editor), and sort a long "Pocket" folder into smaller ones.

## Finding things again

Pocket was often a place to find a link you half remembered. On the dashboard:

- **Start typing anywhere.** A search palette opens on the first character and matches bookmark titles, URLs and folder names across the whole active source.
- **Search from the address bar.** In Chrome and Firefox, type `bb`, press Tab, and search the active source without opening the dashboard.
- **Save as you browse.** The extension's toolbar popup saves the page you are on to the active source in one click.

## If you want your saves as files

Pocket kept your list on its servers. If you would rather own the files, turn on a Markdown vault. Each bookmark is one Markdown file with the URL and title in its front matter, inside ordinary folders on your disk. You can open, back up or version those files with any tool. Setup is one command, `npx bookmarks-but-better@latest`, and [Markdown vaults](/docs/daemon/) explains how it works.

This is also how the extension works in Safari, which does not give extensions access to its bookmarks. See [Safari](/docs/start/safari/).

## When this is not the right replacement

Be clear about what you are giving up. Bookmarks But Better does not:

- save a copy of the article or a reading view
- work offline with saved pages (cached site icons do keep loading offline)
- keep highlights, tags or a read/unread queue
- have phone apps or built-in sync between devices

If you mostly used Pocket to read later, look for an app built for reading. If you mostly used it to collect links and find them again, a bookmarks dashboard you see on every new tab covers that well, and your data stays with you.

## Get started

- Install for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website).
- Try the [live preview](/preview/) first. It uses demo bookmarks and needs no install.
- Then open **Settings → Data & Migration** and import your Pocket CSV.
