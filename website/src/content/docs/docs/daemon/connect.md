---
title: Connect the extension
description: Connect the extension to the local daemon at 127.0.0.1:52222, allow the loopback permission, refresh Vaults, rename them and forget a daemon.
sidebar:
  order: 2
---

Once the daemon is running, connect the extension to it. Each Vault the daemon
serves then shows up as its own [bookmark source](/docs/start/sources/).

## Before you start

Check that the daemon is running:

```bash
npx bookmarks-but-better@latest status
```

When everything is fine, the last lines say `everything is in place`. If no
browser is connected yet, the status also shows the address to connect to. If
something needs fixing, see [Troubleshooting](/docs/daemon/troubleshooting/).

## Connect

1. Open the extension's **Settings → Sources**.
2. Under **Daemons**, leave the address as `http://127.0.0.1:52222`, or change
   it if your daemon uses another port.
3. Click **Connect**.
4. Your browser asks for permission to reach the address. Allow it.

The extension then checks that the daemon answers, finds its Vaults, and
switches the dashboard to a Vault. Your browser bookmarks stay enabled, so you
can switch back at any time.

You can also connect during the [setup wizard](/docs/start/install/#the-setup-wizard)
by turning on **Local vault**.

### About the address and the permission

- The address must be `127.0.0.1` or `localhost`, over `http`. You can type it
  without `http://`, and if you leave out the port, `52222` is used.
- The extension does not ask for permission to reach your computer when you
  install it. It asks only when you click **Connect**.
- The connection is saved only if the daemon really answers.
- If the daemon cannot be reached later, the extension shows an error. It never
  quietly shows your browser bookmarks instead.

Under **Advanced**, there is an optional bearer token field. Leave it blank.

## What you see after connecting

In **Settings → Sources**, each daemon has a card with:

- its address and status: **Checking…**, **Connected** or **Unreachable**,
  along with how many Vaults it serves
- one row per Vault, with a **Rename** button, a **Use** button (or the
  **Active** badge), and a switch to enable or disable it
- a menu button with **Refresh Vaults** and **Forget daemon**

If the daemon does not answer, the card shows **Retry** and suggests running
`npx bookmarks-but-better@latest status` to find out why.

## Refresh Vaults

The extension does not notice on its own when you add or remove a Vault. After
you run `npx bookmarks-but-better@latest vault add` or `vault remove`, open the
daemon's menu in **Settings → Sources** and click **Refresh Vaults**. See
[Multiple vaults](/docs/daemon/multiple-vaults/).

## Rename a Vault's label

Click the pencil button next to a Vault, type a **Display label**, and click
**Save label**. The label only applies in this browser profile. It does not
rename the Vault on disk or change its id.

## Disable a Vault or forget a daemon

- **Disable** a Vault with its switch to hide it from the dashboard. The
  connection is kept, so you can turn it back on later.
- **Forget daemon** removes the connection and all its Vaults from this browser
  profile. Your Vault folders on disk are not touched.

At least one source must stay enabled. To use a Vault only, first make sure the
Vault is enabled, then turn off Browser bookmarks.

## Connect another daemon

If you run a daemon on another port, click **Connect another daemon** and
enter its address.

## Connection errors

| Message                                                                              | What to do                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `… is not loopback — the daemon is only reachable at 127.0.0.1 or localhost.`        | Use `127.0.0.1` or `localhost`.                                                             |
| `Permission to reach the daemon was not granted, so nothing was contacted.`          | Click **Connect** again and allow the permission.                                           |
| `No response from http://127.0.0.1:52222 within the timeout.`                        | The daemon is not answering. Run `npx bookmarks-but-better@latest status`.                  |
| `The daemon at … reported an unhealthy status (…).`                                  | Run `npx bookmarks-but-better@latest status` and follow the fixes it lists.                 |

For more, see [Troubleshooting](/docs/daemon/troubleshooting/).
