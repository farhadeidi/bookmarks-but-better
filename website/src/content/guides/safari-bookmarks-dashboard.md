---
title: "A Bookmarks Dashboard for Safari on Mac"
description: "How Bookmarks But Better works in Safari: a bookmarks dashboard served from Markdown files by a local daemon, opened from the toolbar. Requirements and setup."
publishedAt: 2026-09-15
---

Bookmarks But Better runs in Safari on macOS 14 (Sonoma) or later with Safari 17 or later, but differently from Chrome and Firefox. The Safari build can't read Safari's own bookmarks or replace the new tab page. Instead, it shows bookmarks from Markdown files served by a small local daemon, and you open the dashboard from the toolbar popup. There is no App Store listing yet: today you build the Safari app from the source code with Xcode.

## Why Safari is different

In Chrome and Firefox, the extension can use the browser's bookmarks and take over the new tab page. The Safari build has neither of those:

| | Safari | Chrome and Firefox |
| --- | --- | --- |
| Browser bookmarks as a source | No | Yes |
| Markdown vault through the daemon | Yes | Yes |
| Replaces the new tab page | No | Yes |
| `bb` address-bar search | No | Yes |
| Toolbar popup (save page, open dashboard) | Yes | Yes |

Safari's extension support doesn't provide a bookmarks API, so the extension has no way to read Safari's bookmarks. **Your Safari bookmarks are never read.** The dashboard instead shows a **vault**: a folder of Markdown files on your Mac, served to the extension by the daemon over `127.0.0.1` only.

Safari also offers no new tab override, so the new tab stays Safari's own start page. You reach the dashboard from the extension's toolbar popup, using **Open the dashboard**.

## Requirements

- macOS 14 (Sonoma) or later, and Safari 17 or later
- The Bookmarks But Better daemon, installed on the same Mac
- For now, Xcode, to build the Safari app yourself (see below)

## How to get it today

Safari extensions ship inside a Mac app. Apple's guidance is to [use the App Store to download and install Safari extensions](https://support.apple.com/en-us/102343), where they are reviewed and signed by Apple. Bookmarks But Better isn't published there yet, and there is no separately signed download.

What exists is a build from the public repository:

1. Clone [the repository](https://github.com/farhadeidi/bookmarks-but-better) on a Mac with Xcode installed.
2. Run `bun install`, then `bash safari/build.sh`. This builds the extension and wraps it in a macOS app, signed ad hoc. No Apple Developer account is needed.
3. Open the built app once so Safari finds the extension.
4. In Safari, open **Settings → Advanced**, turn on the features for web developers, then choose **Develop → Allow Unsigned Extensions**.
5. Enable **Bookmarks But Better Extension** in **Safari → Settings → Extensions**.

Two limitations of this route:

- **Allow Unsigned Extensions** resets every time Safari quits. If the extension disappears after a restart, turn it on again.
- An ad hoc signed build is meant for the Mac that built it.

GitHub releases include a zip of the Safari extension files. That zip isn't an installable app; it still has to be wrapped by the Xcode project. The [Safari docs page](/docs/start/safari/) has the full, current steps.

## Setting up the daemon and a vault

The daemon is a small background program that serves your bookmarks from a folder you choose. With Node.js installed, one command does the whole first run:

```sh
npx bookmarks-but-better@latest
```

It installs the daemon into your user folder (no `sudo`), asks where your bookmarks should live, and starts it as a background service. Without Node.js, the install script on the [daemon page](/daemon/) does the same when given a folder. During setup, the Safari onboarding suggests keeping the vault in a synced folder like iCloud Drive if you want the same bookmarks on every Mac.

Then connect:

1. Click the extension icon in the toolbar and choose **Open the dashboard**. On a fresh profile, setup starts with **Connect your vault**.
2. Enter the daemon's address, `127.0.0.1:52222` by default, and click **Connect**.
3. Safari asks for permission to access `127.0.0.1`. The extension asks at this moment, not at install. Allow it.

The vault's bookmarks appear. With only one source there's no source switcher, just your bookmarks. More detail: [install the daemon](/docs/daemon/install/) and [connect the extension](/docs/daemon/connect/).

## Using it day to day

- **Save the current page.** Click the toolbar icon and use **Save bookmark**. The popup names the vault it saves to, and the bookmark appears as a Markdown file in the vault folder.
- **Search.** Start typing anywhere on the dashboard to search bookmark titles, URLs and folder names.
- **Organize.** Use the Bookmark Organizer to drag, rename, create and delete bookmarks and folders.
- **Edit the files directly.** A bookmark is a Markdown file with the URL and title in its front matter. Change files in any editor, and an open dashboard tab updates on its own.

## Moving Safari bookmarks into a vault

Because the extension never reads Safari's bookmarks, getting them in is an explicit step. Apple documents exporting bookmarks and other browsing data with **File → Export Browsing Data to File**, which [saves the data as a .zip file](https://support.apple.com/guide/safari/ibrwebf10132/mac). The dashboard's **Settings → Data & Migration → Import** accepts a standard HTML bookmarks file (or a Raindrop or Pocket CSV) and imports it into the vault, with a preview first. So the file you choose there has to be an HTML bookmarks file, not the .zip itself. See [import and export](/docs/start/import-export/).

## Privacy

The daemon binds only to `127.0.0.1`/`localhost` and makes no outbound requests of its own. The extension has no account, analytics or tracking. Its only outside requests are site icon lookups, which send a bookmark's origin (never the full URL) to Google's favicon service when no local copy exists. In Safari, the extension's permissions are activeTab, storage and tabs, plus localhost access once you connect. See the [privacy page](/privacy/).

## Get started

- Try the dashboard in the [live preview](/preview/). It uses demo bookmarks and needs no install.
- Build and connect it with the [Safari setup docs](/docs/start/safari/).
- Using Chrome or Firefox as well? Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=website) or [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=website) and connect the same daemon.
