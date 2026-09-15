---
title: Install the extension
description: Install Bookmarks But Better from the Chrome Web Store or Firefox Add-ons, find out where Safari stands, and finish the first-run setup.
sidebar:
  order: 1
---

Bookmarks But Better replaces your new-tab page with a dashboard of your
bookmarks. There is no account to create, and the extension collects no analytics
and none of your bookmarks.

## Chrome

1. Open the [Chrome Web Store listing](https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif).
2. Add the extension to Chrome.
3. Open a new tab. The setup wizard starts on its own.

## Firefox

1. Open the [Firefox Add-ons listing](https://addons.mozilla.org/firefox/addon/bookmarks-but-better/).
2. Add the extension to Firefox.
3. Open a new tab. The setup wizard starts on its own.

## Safari

Safari is supported, but it works differently. It needs the local daemon, and it
is not yet available from the Mac App Store or as a signed download. See
[Safari](/docs/start/safari/) for what that means and how to run it today.

## The setup wizard

The wizard only shows the steps your browser needs. A counter at the top shows
where you are, for example **Step 1 of 3**. **Skip setup** is on every step
except the last one, and pressing Escape does the same. Skipping leaves your
sources as they are and keeps the suggested root folder.

1. **Your bookmarks.** Choose where the dashboard gets bookmarks from, using two
   switches:
   - **Browser bookmarks**: the bookmarks already in this browser. This is on
     by default.
   - **Local vault**: bookmarks kept in a folder on your computer by the
     Bookmarks But Better daemon.

   You can turn on one or both, but at least one stays on. With both on, you
   switch between them from the top of the dashboard. The two are never mixed.
   See [Bookmark sources](/docs/start/sources/).
2. **Connect your vault.** This step only appears when **Local vault** is on.
   It shows the command that installs the daemon (`npx bookmarks-but-better@latest`)
   and a form to connect to it. If you are not ready yet, click **Skip for now**.
   You can connect a vault later in **Settings → Sources**. See
   [Install the daemon](/docs/daemon/install/) and
   [Connect the extension](/docs/daemon/connect/).
3. **Choose your bookmark folder.** The dashboard shows only what is inside this
   folder. You can pick an existing folder, or type a name such as
   `Personal Bookmarks` and click **Create folder** to make a new one. This step
   only appears when there is a folder to choose.
4. **You're all set.** A few tips the dashboard does not show on its own:
   - Start typing anywhere to search.
   - Use the arrow keys to move between bookmarks.
   - In Chrome and Firefox, type `bb` then Tab in the address bar to search
     your bookmarks.

   Click **Open dashboard** to finish.

To run the wizard again, open **Settings → General** and click
**Show setup wizard**.

## Choose a root folder

The root folder decides which part of your bookmarks the dashboard shows. You
can change it at any time:

- **From the dashboard header.** The control next to the source switcher shows
  the folder in view. Click it to pick another. Choose **All bookmarks** to show
  everything again.
- **From Settings.** Open **Settings → Sources**. Under **Browser**, use
  **Root folder**. This option is only shown while Browser bookmarks is the
  active source.

Each source remembers its own root folder, so switching sources does not change
it.

## If the new tab does not load

If a new tab ever stays blank or shows an error card, you can still reach
Settings from your browser's extensions page. Open **Settings → General** and
turn on **Safe mode**. The new tab then opens without drawing your bookmarks,
so you can change the root folder or source that causes the problem. Turn Safe
mode off again when you are done.
