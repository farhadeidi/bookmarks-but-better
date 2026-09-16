---
title: Multiple vaults
description: Serve several Vaults from one daemon with vault add, vault remove and vault list, choose ids, and see why each Vault stays a separate source.
sidebar:
  order: 3
---

One daemon can serve several Vaults, such as one for work and one for reading.
Each Vault is its own folder and its own [bookmark source](/docs/start/sources/).
They are never combined, and you switch between them the same way you switch
between any sources.

## Add a Vault

```bash
npx bookmarks-but-better@latest vault add work ~/Work/bookmarks
```

If you leave out the id and the path, the manager asks for both. Then:

1. If the folder is not a Vault yet, it asks
   **… is not a vault yet. Create one there?** Answer yes to create one.
2. It adds the Vault to the list the daemon serves.
3. It asks whether to restart the background service so the daemon serves the
   new Vault. When it has restarted, you see a message such as
   `Service restarted; hosting default, work`.

Then, in the extension, open **Settings → Sources**, open the daemon's menu, and
click **Refresh Vaults**. The new Vault appears as a new source.

## List your Vaults

```bash
npx bookmarks-but-better@latest vault list
```

Next to each Vault, the list shows the state of its folder:

| State               | Meaning                                                   |
| ------------------- | --------------------------------------------------------- |
| `ok`                | The folder is a Vault.                                    |
| `served now`        | A daemon is serving this Vault right now.                 |
| `not initialized`   | The folder exists but is not a Vault yet.                 |
| `directory missing` | The folder does not exist.                                |
| `not a directory`   | The path points to a file, not a folder.                  |

`npx bookmarks-but-better@latest status` also tells you whether the running
daemon serves each Vault on the list (`hosted`, or `configured, not hosted`).

## Remove a Vault

```bash
npx bookmarks-but-better@latest vault remove work
```

This removes the Vault from the list and restarts the service. **The folder and
everything in it stay exactly where they are.** Afterwards, use
**Refresh Vaults** in the extension.

If you remove the last Vault, the background service is removed too, because
there is nothing left to serve. It comes back when you add a Vault and run
`npx bookmarks-but-better@latest install`.

## Ids

Each Vault has an id, such as `work`:

- An id is 1 to 64 characters: lowercase letters, digits and hyphens.
- Each id must be unique.
- The Vault created during installation has the id `default`.
- The extension finds a Vault by its id. If you change an id, the extension
  sees that Vault as gone and a new one as added.

## Folders must not overlap

A Vault's folder cannot be inside another Vault's folder. Use folders side by
side instead, such as `~/vaults/work` and `~/vaults/reading`. If two folders
overlap, the manager refuses to add the Vault and explains why:

```text
the vault roots /home/you/vaults and /home/you/vaults/work overlap; host sibling directories instead
```

## Why a restart is needed

The daemon reads its list of Vaults once, when it starts, so adding or removing
a Vault only takes effect after a restart. The manager restarts the service for
you when you add or remove a Vault. If you decline the restart, the running
daemon keeps serving its current Vaults until the service is reinstalled, for
example with `npx bookmarks-but-better@latest install`.

## The configuration file

The list of Vaults is kept in one file, together with the port, the address the
daemon listens on, and the web app folder:

- macOS and Linux: `~/.config/bookmarks-but-better/config.toml`
- Windows: `%USERPROFILE%\.config\bookmarks-but-better\config.toml`

```toml
port = 52222
bind = "127.0.0.1"

[vaults.default]
path = "/home/you/Bookmarks"

[vaults.work]
path = "/home/you/Work/bookmarks"
```

The `vault` commands write this file. You can also edit it by hand: your edits
are kept, and a mistyped setting name is reported as an error rather than
ignored. A hand edit takes effect when the service is reinstalled with
`npx bookmarks-but-better@latest install`.
