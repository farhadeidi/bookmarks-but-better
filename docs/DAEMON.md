# The `bbb` daemon

The extension can point at a local `bbb` daemon — a small background process
that serves your bookmarks from a folder of Markdown files instead of the
browser's own bookmark store, over `127.0.0.1`/`localhost` only.

This is entirely optional. Browser and standalone modes need nothing on this
page.

## Status: beta, no stable release yet

The daemon has never been part of a stable release. Every stable release so far
(up to and including `v3.2.0`) ships the Chrome and Firefox extensions and
nothing else — there is no `bbb` binary in any of them.

The daemon is published only as **prereleases** (`v4.0.0-beta.N`), so
everything below installs a prerelease, by fallback or because you asked for
one by name. Treat it as beta software: it is versioned, checksummed and
upgradable in place, but the stable-channel guarantees the extensions have do
not apply to it yet.

## Install

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/farhadeidi/bookmarks-but-better/main/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/farhadeidi/bookmarks-but-better/main/install.ps1 | iex
```

Both scripts default to the latest stable release. Because no stable release
carries a daemon build yet, they report that and fall back to the newest
prerelease that does:

```
resolving the latest stable release
the latest stable release (v3.2.0) ships no bbb daemon build for x86_64-unknown-linux-gnu
falling back to the latest prerelease — pass --version <tag> to pin a specific release
installing v4.0.0-beta.2 (version 4.0.0-beta.2)
```

The fallback is announced, never silent, and it disappears on its own the day a
stable release carries a daemon build: from then on the same command installs
that instead.

To choose explicitly rather than rely on the fallback:

| What you want | macOS / Linux | Windows |
| --- | --- | --- |
| The latest prerelease | `bash -s -- --beta` | `-Beta` |
| One exact release | `bash -s -- --version v4.0.0-beta.2` | `-Version v4.0.0-beta.2` |
| Install without running setup | `bash -s -- --skip-setup` | `-SkipSetup` |

With `curl … | bash`, arguments go after `-s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/farhadeidi/bookmarks-but-better/main/install.sh | bash -s -- --beta
```

Pipe into `bash`, not `sh`: the script uses `set -o pipefail`, which is a bash
builtin option, and `/bin/sh` is dash on Debian and Ubuntu.

## What the install scripts do

- Install into a user-local directory — `~/.local/share/bbb` and
  `~/.local/bin` on macOS and Linux, `%LOCALAPPDATA%\bbb` on Windows. No
  `sudo`, no administrator prompt, nothing system-wide.
- Verify the downloaded archive against its published SHA-256 checksum and
  refuse to install if it does not match.
- Unpack into a versioned directory and only then repoint `current` at it, so a
  failed download or a binary that will not run leaves the previous install
  untouched and rollback-able.
- Finish by running `bbb setup`, which asks where your vault should live and
  which port to serve it on. Setup is a conversation, so it needs a terminal; if
  there is none (CI, a container), the install still completes and tells you to
  run `bbb setup` yourself.

Uninstalling is deleting the install directory and the `bbb` symlink. Your
vault is a directory of Markdown files that neither script has ever heard of.

## Connecting the extension

Once the daemon is running, open the extension's Settings → **Bookmark
Source** → **Daemon**, enter the daemon's address (`127.0.0.1:52222` by
default) and click **Connect**.

The extension only requests permission to reach loopback addresses at that
point — never at install time — and only switches to the daemon if a real
health check against it succeeds. A daemon that cannot be reached is reported
as an error, never a silent fall back to your browser bookmarks.

## More

See [crates/bbb/README.md](../crates/bbb/README.md) for the daemon itself — the
HTTP API, the background-service integration for each OS, and what
`bbb service install` does.
