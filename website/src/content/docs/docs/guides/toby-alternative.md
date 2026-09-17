---
title: "A Toby alternative with no tab limit"
description: "Toby alternative compared: tab manager or bookmark manager, the 60-tab free plan, where your data lives, and how to bring a Toby export across."
sidebar:
  label: Toby alternative
  order: 5
---

Toby and Bookmarks But Better both put a grid of saved links on your new tab, so people often look at one while deciding about the other. They are built for different jobs. Toby is a tab manager: you save whole browsing sessions into shared Spaces, and it stores them for you. Bookmarks But Better is a bookmark manager with no account that shows the bookmarks your browser already has, or Markdown files on your own disk.

Facts about Toby below come from Toby's own pages, as of September 2026, and are linked where they are used.

## The short version

| | Toby | Bookmarks But Better |
| --- | --- | --- |
| What it saves | Browser tabs, grouped into collections and Spaces | Bookmarks, in the folders you already keep them in |
| Account | Required for sync: "Your Spaces stay in sync across every browser and device you sign in to" ([gettoby.com](https://www.gettoby.com/)) | None |
| Saved-item limit | "Up to 60 saved tabs" on the Starter plan ([Toby pricing](https://www.gettoby.com/pricing)) | No limit |
| Where data lives | Toby's service, reachable from its apps and extensions | Your browser's bookmark store, or Markdown files in a folder you choose |
| Sharing | "Invite your team into a Space" and custom share links ([gettoby.com](https://www.gettoby.com/)) | None |
| Platforms | Chrome, Firefox and Edge, plus iOS and Android apps ([gettoby.com](https://www.gettoby.com/)) | Chrome and Firefox; Safari coming soon (build it from source today), using a local daemon |
| Cost | Free to start, then $6/member/month (Productivity) or $10/member/month (Team) ([Toby pricing](https://www.gettoby.com/pricing)) | Free and open source (MIT) |

## The 60-tab ceiling

The difference most people run into first is the Starter plan's cap of 60 saved tabs ([Toby pricing](https://www.gettoby.com/pricing)). Sixty is enough to try the idea and not enough to move a real bookmark collection into. Past that you either prune or subscribe.

Bookmarks But Better has no such number. The extension and the daemon are both MIT-licensed and free, so a collection of five thousand bookmarks works exactly like a collection of five.

## Tabs or bookmarks

Toby's unit is the tab. You collect the tabs that are open right now, name the group, and close them, which is why it works well for research sessions and for handing a set of links to a colleague.

Bookmarks But Better's unit is the bookmark you already have. It reads your browser's bookmark tree through the browser's own API and draws each folder as a card on the new tab. Nothing is copied into a second store, so your bookmarks bar, your browser's own bookmark sync and any other bookmark tool keep working exactly as before. If you stop using the extension, the bookmarks are still where they were.

That also means it does not do what Toby's Spaces do. There is no team workspace, no shared collection and no public share link.

## Where your data lives

Toby keeps your Spaces on its service and syncs them to every browser and device you sign in to ([gettoby.com](https://www.gettoby.com/)).

Bookmarks But Better has no server and no account. Bookmarks come from one of two sources, and the two are never merged:

- **Browser bookmarks.** Read and edited through Chrome's or Firefox's own bookmark APIs. Your browser's built-in bookmark sync carries them between your own machines, the same as it always did.
- **Markdown vaults.** Folders of Markdown files on your disk, served to the extension by a small daemon that only listens on `127.0.0.1`/`localhost`. One file per bookmark, one folder per bookmark folder, no hidden database.

The [sources overview](/docs/start/sources/) explains how switching between them works. The extension makes one kind of outside request by default: site icon lookups, which send a bookmark's origin such as `https://example.com`, never the full path. The [privacy page](/privacy/) has the details.

## What you give up

Be honest with yourself about these before switching:

- No team Spaces, no shared collections, no share links.
- No syncing of its own. Browser bookmarks ride your browser's sync; a vault folder rides whatever file sync you already use.
- No phone apps.
- No session capture. It saves one page at a time from the toolbar popup, not every open tab at once.

If those are why you use Toby, Toby is the right tool and this is not.

## Moving from Toby

Toby can export a collection as JSON, HTML or TXT ([Toby support](https://help.gettoby.com/support/solutions/articles/66000508502-how-to-export-your-collections)). Use **HTML**, which is the standard bookmarks file format every browser reads.

1. In Toby, open a collection's menu (the three dots beside its title) and choose **export**, then **HTML**.
2. Repeat for each collection you want to keep.
3. In Bookmarks But Better, switch to the source the bookmarks should live in.
4. Open **Settings → Data & Migration → Import** and choose the file.
5. Review the preview, pick a destination folder, resolve any conflicts, and import.

The HTML file carries titles, URLs and nested folders. Toby's notes and tags only survive in its JSON export, which this importer does not read, so copy anything you need from those before you move. See [import and export](/docs/start/import-export/) for the full steps.

## Which one fits

Toby is the better choice if you work in sessions of open tabs, share collections with a team, or want your links on a phone.

Bookmarks But Better is the better choice if you want your existing bookmarks on the new tab, no account, and no cap on how much you keep.

## Get started

- Install for [Chrome](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website).
- Try the [live preview](/preview/) with demo bookmarks, no install needed.
- Want bookmarks as files? Read about [Markdown vaults](/docs/daemon/).
