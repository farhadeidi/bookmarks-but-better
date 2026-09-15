---
title: "Turn Your New Tab Page Into a Bookmarks Dashboard"
description: "Replace the Chrome or Firefox new tab page with a bookmarks dashboard that shows the bookmarks you already have. Root folder, themes, search and the bb keyword."
publishedAt: 2026-09-15
---

Install Bookmarks But Better in Chrome or Firefox, and every new tab opens a dashboard of the bookmarks you already have. It reads and edits them through the browser's own bookmark APIs. Nothing is copied, moved or deleted unless you do it yourself. You can pick which folder the dashboard starts from, choose a theme, and search from the page or from the address bar.

## What changes when you install it

The extension replaces the browser's new tab page. In Firefox, it can also be set as your homepage.

Your bookmark folders appear as cards in a responsive masonry grid. Each card shows its bookmarks as a list or as a grid of site icons, and you choose per folder. If there are several sources to choose from, a switcher sits in the header. A setup dialog runs once on a fresh profile and can be skipped straight to the dashboard.

The extension is free and open source (MIT), with no account, analytics or tracking.

## What happens to your existing bookmarks

With the default **browser bookmarks** source:

- The dashboard reads the bookmark tree your browser already has, through its built-in bookmark API.
- Edits you make on the dashboard or in the organizer (renaming, reordering, moving, creating, deleting) go through the same API. They are real changes to your browser bookmarks, the same ones you'd see in the browser's own bookmark manager.
- Nothing is moved, merged or deleted on its own. Opening a new tab changes nothing.
- The bookmarks never leave the browser's bookmark store. There is no copy on a server.

You can also add a **Markdown vault**, bookmarks stored as files on your disk and served by an optional local program. It is a separate source. Switching between sources never merges or moves bookmarks, and every operation affects only the source you are looking at. See [how sources work](/docs/start/sources/).

## Choosing the root folder

Browsers split bookmarks into areas such as the bookmarks bar and other bookmarks, and you may not want all of it on your new tab. A control in the header, next to the source switcher, shows the folder currently in view and opens a folder picker. Pick any folder to start the dashboard there. When you've narrowed the view, a one-click reset takes you back to all bookmarks.

The root folder only changes what the dashboard shows. It doesn't move anything, and it is saved separately for each source.

## Organizing

The **Bookmark Organizer** is a full tree editor. You can:

- drag bookmarks and folders to reorder them or move them between folders
- rename, create and delete bookmarks and folders
- expand or collapse the whole tree, or show folders only

Titles and URLs can also be edited inline on the dashboard. The keyboard works throughout: the grid is a single tab stop, arrow keys move in the order you see, Home and End jump to a column's ends, and Enter opens the focused bookmark.

## Search

Two ways to find a bookmark without scrolling:

- **On the dashboard, just start typing.** A search palette opens on the first character. It matches bookmark titles, URLs and folder names across the whole active source, including folders outside the root folder you picked. Each result shows its folder path and can be revealed in the organizer.
- **From the address bar, type `bb` and press Tab.** You can then search the active source's bookmarks without opening a new tab. This works in Chrome and Firefox. The suggestions line names the source being searched.

## Themes

Ten color themes are included: Default, Amber Minimal, Bubblegum, Caffeine, Claude, Claymorphism, Cyberpunk, Solar Dusk, T3 Chat and Vintage Paper. Each works in light and dark mode, and can follow your system setting. The theme is applied before the first paint, so a dark new tab doesn't flash white.

## Saving the page you're on

Click the extension's toolbar icon to open a small popup that saves the current tab as a bookmark in the active source. The popup shows where the bookmark will go.

## Import and export

**Settings → Data & Migration** imports a standard HTML bookmarks file from any browser, or a CSV export from Raindrop or Pocket, into the active source, with a preview and conflict handling first. Export saves bookmarks as an HTML file any browser can import. See [import and export](/docs/start/import-export/).

## What it asks for, and what it sends

Permissions, from the [privacy page](/privacy/):

- **Chrome:** bookmarks, storage, activeTab, favicon and clipboardWrite
- **Firefox:** bookmarks, storage and activeTab

Localhost access is requested only if you connect a local vault daemon, at that moment, never at install.

The only outside requests by default are site icon lookups. A bookmark's origin (for example `https://example.com`, never the path) may be sent to Google's public favicon service when neither the local icon cache nor the browser's own icon store has it. Icons are cached on your machine for 30 days and keep working offline.

## If the new tab stops loading

If something goes wrong while drawing the dashboard, it shows an error card instead of a blank page, with buttons to open Settings or reload in **safe mode**, which skips drawing bookmarks until you turn it off. Settings is also reachable from the browser's extensions page when the new tab itself won't open.

## Safari

Safari doesn't let extensions replace the new tab page or read browser bookmarks, so it works differently there. See the [Safari guide](/guides/safari-bookmarks-dashboard/).

## Get started

- Install for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website).
- Try the [live preview](/preview/) with demo bookmarks first.
- Step-by-step setup: [install the extension](/docs/start/install/).
