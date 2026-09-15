---
title: Markdown vaults
description: Keep your bookmarks as plain Markdown files in a folder you own, served to the extension by a small local daemon on your own computer.
sidebar:
  label: Overview
  order: 0
---

A **Vault** is a folder of Markdown files that holds your bookmarks. A small
background program, the **daemon**, serves it to the extension. In Chrome and
Firefox a Vault is optional and appears next to your browser bookmarks as a
separate [bookmark source](/docs/start/sources/). In
[Safari](/docs/start/safari/) it is the only source.

## Why keep bookmarks as files

Browsers keep bookmarks in an internal database that is hard to read, back up
or edit with your own tools. A Vault turns that around:

- Each bookmark is one Markdown file, and each bookmark folder is a folder on
  disk. There is no hidden database.
- The files stay usable in a text editor, in Obsidian and in Git. See
  [Obsidian bookmarks as Markdown files](/guides/obsidian-bookmarks/).
- The backup tools you already use work for it. See
  [Back up your vault](/docs/daemon/backups/).

## How it stays private

- The daemon only accepts connections from your own computer (`127.0.0.1` or
  `localhost`).
- It has no accounts and sends no telemetry.
- The extension asks for permission to reach the daemon when you click
  **Connect**, never at install time.

## Get started

1. [Install the daemon](/docs/daemon/install/). With Node.js, one command does
   the first run: `npx bookmarks-but-better@latest`.
2. [Connect the extension](/docs/daemon/connect/) in **Settings → Sources**.
3. Optionally, [host several vaults](/docs/daemon/multiple-vaults/) in one
   daemon. Each one is its own source.

If something does not work, see [Troubleshooting](/docs/daemon/troubleshooting/).
To remove the daemon, see [Uninstall](/docs/daemon/uninstall/). Your Vault stays
where it is.
