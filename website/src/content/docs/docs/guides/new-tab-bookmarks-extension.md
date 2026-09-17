---
title: "Put your bookmarks on your new tab page"
description: "How a new tab bookmarks extension works in Chrome and Firefox, what it replaces, how to choose which folder shows, and how to put it back."
sidebar:
  label: Bookmarks on your new tab
  order: 7
---

A browser's new tab page is the page you see most often and use least. Chrome fills it with a search box and thumbnails of sites you visited recently. Firefox fills it with shortcuts and a feed. Meanwhile the bookmarks you deliberately chose to keep sit behind a menu, or squeezed into a bar that fits about nine of them.

A new tab extension changes what that page is. Bookmarks But Better turns it into a dashboard of your own bookmarks, where every folder is a card. This guide covers what that actually changes in the browser, how to point it at the right folder, and how to undo it.

## What gets replaced, and what does not

The extension overrides one thing: the page your browser draws when you open a new tab. It does that through the standard new-tab override that Chrome and Firefox both support.

Everything else stays where it was:

- Your bookmarks stay in your browser's bookmark store. The dashboard reads and edits them through the browser's own bookmarks API, so nothing is copied into a second place.
- Your bookmarks bar, the bookmark manager, and the star button in the address bar all keep working.
- Your browser's own bookmark sync keeps working, because these are the same bookmarks it was always syncing.
- Your home page and startup pages are untouched. A new tab is a different setting from either.

Uninstalling gives you the default new tab back, with every bookmark still in place. Nothing has to be migrated back.

## What you get instead

- **Folders as cards.** The dashboard lays your folders out in a masonry grid. Each card shows its bookmarks as a list or as an icon grid.
- **Search by typing.** Start typing anywhere on the dashboard and a search palette opens, matching titles, URLs and folder names in the active source.
- **Address-bar search.** In Chrome and Firefox, type `bb`, press Tab, then type, and search your bookmarks without opening the dashboard at all.
- **A real organizer.** Drag bookmarks between folders, reorder them, rename, create and delete, in a tree editor rather than a context menu.
- **Quick capture.** The toolbar popup saves the page you are on into the active source.
- **Ten themes**, each with light, dark and system modes.

You can see all of it before installing anything, on the [live preview](/preview/), which runs the real dashboard on demo bookmarks.

## Show one folder instead of all of them

Most people's bookmarks are years of accumulation, and putting all of it on the new tab is not an improvement. The dashboard has a root folder for this: it draws only what is inside the folder you choose.

Set it from the control next to the source switcher in the header. There is also **Settings → Sources → Root folder**, which only appears while Browser bookmarks is the active source. Choose **All bookmarks** to go back to everything.

A folder like `Daily` or `Personal Bookmarks` with six or seven subfolders makes a far better new tab than a dump of everything you ever saved. The rest stays in your browser, searchable, just not on screen. Each source remembers its own root folder, so switching sources does not reset it.

## Browsers

**Chrome and Firefox** both support overriding the new tab, so the dashboard appears there on its own after you install, and a setup wizard starts on the first new tab. Chrome may ask you to confirm the change before it takes effect. See [Install the extension](/docs/start/install/).

**Safari** does not let extensions override the new tab at all, and gives them no access to Safari's bookmarks either. The Safari build is coming soon and works differently: you open the dashboard from the toolbar popup, and its bookmarks come from a [Markdown vault](/docs/daemon/). [Safari](/docs/start/safari/) explains the details.

## If a new tab ever fails to load

Open **Settings → General** from your browser's extensions page and turn on **Safe mode**. The new tab then opens without drawing bookmarks, so you can change the root folder or the source that caused the trouble, then turn Safe mode back off.

## Putting it back

Remove the extension from your browser's extensions page. The new tab returns to the browser's default immediately, and your bookmarks are untouched, because they were never moved in the first place.

## Get started

- Install for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website).
- Try the [live preview](/preview/) first, with demo bookmarks and no install.
- Coming from another tool? See the [Pocket](/docs/guides/pocket-alternative/), [Raindrop](/docs/guides/raindrop-alternative/) and [Toby](/docs/guides/toby-alternative/) guides.
