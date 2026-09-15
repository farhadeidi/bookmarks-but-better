---
title: Safari
description: The Safari version of Bookmarks But Better is coming soon. Until then you can build it from source on macOS 14 or later; it needs the local daemon, opens from the toolbar popup, and has no address-bar keyword.
sidebar:
  order: 4
---

:::note[Coming soon]
The Safari version is not released yet. It is not in the Mac App Store, and
there is no signed download. If you need it now, you can
[build it from source](#build-it-from-source).
:::

Safari works differently from Chrome and Firefox. This page explains what is
different and how to build and set it up yourself.

## Requirements

- **macOS 14 (Sonoma) or later, with Safari 17 or later.**
- **The Bookmarks But Better daemon.** Safari does not let extensions read its
  bookmarks. That means there is no Browser bookmarks source in Safari, and the
  extension never reads Safari's own bookmarks. Your bookmarks live in a
  [Vault](/docs/start/sources/) served by the daemon on your Mac instead. See
  [Install the daemon](/docs/daemon/install/).

## Build it from source

Until the Safari version is released, you can build it yourself on your Mac.
This needs Xcode,
[Bun](https://bun.sh), and a copy of the
[source code](https://github.com/farhadeidi/bookmarks-but-better).

1. From the project folder, run:

   ```bash
   bun install && bash safari/build.sh
   ```

   This builds the app that carries the extension. It does not need an Apple
   Developer account.
2. Open the built app once. It is in `safari/build/Products/Release/`.
3. In Safari, open **Settings → Advanced** and turn on
   **Show features for web developers**.
4. In the menu bar, choose **Develop → Allow Unsigned Extensions**.
5. Open **Safari Settings → Extensions** and turn on
   **Bookmarks But Better Extension**.

:::caution
Safari turns **Allow Unsigned Extensions** off every time it quits. If the
extension disappears after you restart Safari, allow unsigned extensions again.
:::

GitHub releases also include a zip of the Safari extension files. That zip is
not an app you can install. It still has to be built into one with the steps
above.

## First run

1. Install the daemon, and choose where your Vault should live:

   ```bash
   npx bookmarks-but-better@latest
   ```

2. Open the dashboard (see the next section). The setup wizard opens on
   **Connect your vault**. Because Safari has only one kind of source, it skips
   the question about where your bookmarks come from.
3. Click **Connect**. Safari asks for permission to reach `127.0.0.1`. Allow it.
   The extension asks for this permission only when you connect, not when you
   install it.

The wizard suggests keeping your Vault in a synced folder such as iCloud Drive,
so you see the same bookmarks on each of your Macs. A synced folder is not a
backup, though. See [Back up your vault](/docs/daemon/backups/#sync-is-not-backup).

## Opening the dashboard

Safari does not let extensions replace the new-tab page, so new tabs stay
Safari's own. To open the dashboard:

1. Click the Bookmarks But Better icon in the toolbar. If it is not there,
   choose **View → Customize Toolbar** and drag it in.
2. In the popup, click **Open the dashboard**.

The dashboard opens in a tab. If no Vault is connected yet, it shows
**No bookmark source yet.** with a **Connect a daemon** button.

## Saving pages

On any page, click the toolbar icon and then **Save bookmark**. The popup shows
which Vault the bookmark goes to.

## Searching

Safari has no address-bar keyword, so `bb` does not work there. To search, open
the dashboard and start typing.

## Bringing your Safari bookmarks

The extension never reads Safari's bookmarks, so moving them into a Vault is an
explicit step. Safari's **File → Export Browsing Data to File**
[saves your browsing data as a .zip file](https://support.apple.com/guide/safari/ibrwebf10132/mac).
The dashboard's **Settings → Data & Migration → Import** needs an HTML
bookmarks file, not the .zip itself. See
[Import and export](/docs/start/import-export/).

## Differences from Chrome and Firefox

| Feature                                  | Safari | Chrome and Firefox |
| ---------------------------------------- | ------ | ------------------ |
| Browser bookmarks as a source            | No     | Yes                |
| Vaults served by the daemon              | Yes    | Yes                |
| Dashboard replaces the new tab           | No     | Yes                |
| Toolbar popup (save, open the dashboard) | Yes    | Yes                |
| Address-bar search with `bb`             | No     | Yes                |
