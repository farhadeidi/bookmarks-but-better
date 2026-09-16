---
title: Bookmark sources
description: How Browser bookmarks and daemon Vaults work as separate sources, how to switch between them, and how to move off the retiring Standalone source.
sidebar:
  order: 2
---

A **source** is one collection of bookmarks the dashboard can show. Bookmarks
from different sources are never mixed together, and switching sources never
moves or copies anything.

## Kinds of sources

- **Browser Source**: the bookmarks your browser profile already keeps. It is
  listed as **Browser bookmarks**. Chrome and Firefox have it, but Safari does
  not (see [Safari](/docs/start/safari/)).
- **Daemon Source**: one Vault served by the local
  [Bookmarks But Better daemon](/docs/daemon/install/). A Vault is a folder of
  Markdown files on your computer. If the daemon serves several Vaults, each
  one is a separate source.
- **Standalone Source**: an older collection stored inside the browser. It is
  being retired. See [The Standalone source is retiring](#the-standalone-source-is-retiring)
  below.

## Enabled and active sources

You can **enable** several sources at once. Exactly one of them is the
**Active Source**: the one the dashboard shows. Everything you do acts on the
Active Source only:

- adding, editing, moving and deleting bookmarks on the dashboard
- saving a page from the extension's toolbar popup
- searching from the address bar with `bb` (Chrome and Firefox)
- importing a file (see [Import and export](/docs/start/import-export/))

Your source settings belong to the current browser profile and are never
synced. Another profile, or another computer, has its own settings.

## Switch sources

- **From the dashboard.** When more than one source is enabled, a source
  switcher appears at the top of the dashboard. Pick a source there, or choose
  **Manage sources** to open Settings. With only one source enabled, the
  switcher is hidden because there is nothing to switch to.
- **From Settings.** Open **Settings → Sources** and click **Use** next to a
  source. The current one is marked **Active**.

Switching happens in place, without reloading the page. Your theme, layout width
and nested folders stay the same. The root folder and per-folder layouts belong
to each source.

## Enable, disable and rename

In **Settings → Sources**, each source has:

- a switch to enable or disable it. Disabling a source keeps its settings, so
  you can turn it back on later. At least one source must stay enabled. If you
  try to turn off the last one, you get a **Cannot disable** message.
- a pencil button (**Rename**) to give it a display label. The label only
  applies in this browser profile. Renaming a Vault's label does not rename the
  Vault itself.

Daemon Sources also have **Forget daemon**, which removes a daemon connection
and all its Vaults from this profile. See
[Connect the extension](/docs/daemon/connect/).

## When a source cannot be reached

If the Active Source is a Vault and its daemon is not running, the dashboard
shows **Bookmarks are unavailable.** with two buttons: **Retry** and
**Switch source**. The extension never quietly shows your browser bookmarks
instead, because that would look like your Vault had lost its bookmarks. See
[Troubleshooting](/docs/daemon/troubleshooting/) to get the daemon running again.

## The Standalone source is retiring

The Standalone source is an older collection that was stored inside the browser
itself. It is being removed in the next major version:

- New users cannot choose it.
- If your profile was already using it, you keep access until that release.
  While it is active, the dashboard shows a notice titled
  **Standalone bookmarks are going away**.
- Moving your bookmarks is a **copy**. Your Standalone bookmarks are never
  deleted, and you can still read them in Settings until the removal.

### Copy your Standalone bookmarks to another source

1. Open the migration using any of these:
   - **Migrate now** in the dashboard notice
   - **Migrate Standalone bookmarks…** under **Legacy** in **Settings → Sources**
   - **Migrate…** in **Settings → Data & Migration**
2. Under **Copy to**, choose Browser bookmarks or a connected Daemon Source.
3. Optionally, choose a **Destination folder**. If you leave it on the default,
   the copy goes where an import into that source would go.
4. Click **Preview the copy**. The preview shows how many bookmarks and folders
   will be copied, how many are duplicates, and how many bookmarks are already
   in the destination (those stay).
5. Click **Copy now**. If there are duplicates, the button says
   **Resolve duplicates** instead, and you choose what to do with each one (see
   [Duplicates](/docs/start/import-export/#duplicates)).
6. When the copy is checked and correct, you see **Copy verified**. Click
   **Switch to the destination** to start using it, or **Stay here** to keep
   using Standalone for now.

The copy only adds bookmarks and never removes anything from the destination.
If it could not be fully checked, you can run the migration again safely.
