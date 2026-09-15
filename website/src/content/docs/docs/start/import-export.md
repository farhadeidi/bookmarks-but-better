---
title: Import and export
description: Import bookmarks from any browser's HTML export or from Raindrop and Pocket CSV files, handle duplicates, and export to a standard HTML file.
sidebar:
  order: 3
---

Import and export are in **Settings → Data & Migration**, under
**Bookmarks data**. Both work on the [Active Source](/docs/start/sources/). An
import goes into the source you are currently using, and an export saves that
source.

## Import a file

1. Click **Import…** and choose a file. The extension accepts `.html`, `.htm`
   and `.csv` files.
2. Read the summary, for example _Found 120 bookmarks in 8 folders_. For CSV
   files, it also tells you how many rows were skipped because they had no
   valid URL.
3. Choose the folder the bookmarks should go into. If you have chosen a root
   folder, it is selected by default.
4. Optionally, type a name in **Optional: import into a new subfolder** to keep
   the import together in one folder.
5. Click **Import here**. When the import finishes, you see a result such as
   _Imported 118 bookmarks and 8 folders. 2 duplicates skipped._

If an item cannot be saved, the rest of the import still goes ahead, and the
result tells you how many items failed and why.

### From a browser: HTML

Most browsers can export their bookmarks as an HTML file, in a format they all
share. The extension reads that file and brings in:

- folders and the bookmarks inside them, with their nesting
- bookmark titles and URLs
- the date each item was added, when the file includes it

Separators, and entries that have no URL, are left out. A bookmark with no title
is named after its site, for example `example.com`.

### From Raindrop or Pocket: CSV

The extension works out which service a CSV file came from by looking at the
names in its first (header) row:

| The header row has…             | Read as  | Where the bookmarks go                                                                              |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| a `folder` column               | Raindrop | Raindrop's folder paths, such as `Parent/Child`, become nested folders.                             |
| a `time_added` or `status` column | Pocket   | Everything goes into one folder named `Pocket`.                                                     |
| only a `url` column             | Other    | Everything goes into one folder named after the file.                                               |

Only the `url`, `title` and (for Raindrop) `folder` columns are used. Rows whose
URL does not start with `http://` or `https://` are skipped. A file with no
`url` column contains nothing to import.

## Folders with the same name

When an imported folder has the same name as a folder already in that spot
(ignoring upper and lower case), the two are combined: the incoming bookmarks
go into the existing folder. This works the same way at every level.

## Duplicates

A duplicate is an incoming bookmark whose URL is already saved in the folder it
would go into. When comparing URLs, the extension ignores differences in upper
and lower case in the `https://` part and the site name, and treats a default
port as no port. Everything after the site name must match exactly, so
`#/inbox` and `#/sent` are two different bookmarks. Two copies of the same URL
inside the imported file are not treated as duplicates.

If there are duplicates, a dialog opens before anything is written. You can
decide for all of them at once:

- **Skip all**: keep the bookmark that is already there and leave out the
  incoming one.
- **Replace all**: keep one bookmark, and give it the incoming title.
- **Keep both for all**: add the incoming bookmark next to the existing one.

Or click **Review one by one** to decide for each bookmark with **Skip**,
**Replace** or **Keep both**. Tick **Apply my choice to the remaining
conflicts** to use your answer for the rest.

**Cancel import** leaves your bookmarks exactly as they were, because nothing is
saved until you choose.

## Export

Click **Export…** and choose what to export:

- **Dashboard folder**: only the root folder the dashboard shows. It is saved
  as `bookmarks-<folder-name>.html`. This option is only available once you have
  chosen a root folder.
- **Everything**: the whole Active Source, saved as `bookmarks.html`.

The file uses the standard HTML bookmarks format, so any browser can import it.
It contains folders, bookmark titles and URLs, and the dates items were added.

:::caution[An HTML export is not a backup of a Vault]
When the Active Source is a Vault, the export only includes what the HTML format
can hold. It leaves out notes, `*.assets/` folders, and the files that record
the order you arranged things in. To keep a complete copy of a Vault, see
[Back up your vault](/docs/daemon/backups/).
:::
