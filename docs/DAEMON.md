# The `bookmarks-but-better` daemon

The extension can point at a local `bookmarks-but-better` daemon — a small
background process that serves your bookmarks from a folder of Markdown files
instead of the browser's own bookmark store, over `127.0.0.1`/`localhost` only.

This is entirely optional. Browser and standalone modes need nothing on this
page.

## Install

```bash
# macOS / Linux
curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1 | iex
```

```bash
# Any platform, if you already have Node.js
npx bookmarks-but-better@latest
```

All three do the same thing. `install.sh` and `install.ps1` are release assets
under those exact names, so the script that runs is the one published alongside
the archives it installs — not whatever `main` happens to hold. The `npx`
package ships no binaries at all: it downloads the installer for your platform
from the release, verifies it against its published SHA-256, and runs it. The
install it performs is persistent either way; `npx` is only how the installer
got there.

Pipe into `bash`, not `sh`: the script uses `set -o pipefail`, which is a bash
builtin option, and `/bin/sh` is dash on Debian and Ubuntu.

### Choosing a release

Each installer resolves the latest **stable** release by default. Every stable
release up to and including `v3.2.0` was extension-only and carried no daemon
build; when the resolved release has no build for your platform, each reports
that and falls back to the newest prerelease that does:

```
resolving the latest stable release
the latest stable release (v3.2.0) ships no bookmarks-but-better daemon build for x86_64-unknown-linux-gnu
falling back to the latest prerelease — pass --version <tag> to pin a specific release
installing v4.0.0-beta.2 (version 4.0.0-beta.2)
```

The fallback is announced, never silent, and it is not reached at all once the
resolved stable release carries daemon archives.

To choose explicitly rather than rely on the fallback:

| What you want | macOS / Linux | Windows | npx |
| --- | --- | --- | --- |
| The latest prerelease | `bash -s -- --beta` | `-Beta` | `--beta` |
| One exact release | `bash -s -- --version v4.0.0` | `-Version v4.0.0` | `--version v4.0.0` |
| Install without running setup | `bash -s -- --skip-setup` | `-SkipSetup` | `--skip-setup` |

With `curl … | bash`, arguments go after `-s --`:

```bash
curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash -s -- --beta
```

`npx bookmarks-but-better@latest --version v4.0.0` also pins the *installer* to
that release, so both halves come from the same place.

## What the install scripts do

- Resolve a release entirely from GitHub Release URLs — the `/releases/latest`
  redirect, the releases Atom feed, and `/releases/download/<tag>/<asset>`.
  There is no GitHub JSON API call and no `jq` dependency; `curl`, `tar` and a
  SHA-256 tool are the whole toolchain on macOS and Linux.
- Install into a user-local directory — `~/.local/share/bookmarks-but-better`
  and `~/.local/bin` on macOS and Linux, `%LOCALAPPDATA%\bookmarks-but-better`
  on Windows. No `sudo`, no administrator prompt, nothing system-wide.
- Verify the downloaded archive against its published SHA-256 checksum and
  refuse to install if it does not match.
- Unpack into a versioned directory and only then repoint `current` at it, so a
  failed download or a binary that will not run leaves the previous install
  untouched and rollback-able.
- Finish by running `bookmarks-but-better setup`, which asks where your vault
  should live and which port to serve it on. Setup is a conversation, so it
  needs a terminal; if there is none (CI, a container), the install still
  completes and tells you to run `bookmarks-but-better setup` yourself.

Uninstalling is deleting the install directory and the `bookmarks-but-better`
symlink. Your vault is a directory of Markdown files that neither script has
ever heard of.

## Connecting the extension

Once the daemon is running, open the extension's Settings → **Bookmark
Source** → **Daemon**, enter the daemon's address (`127.0.0.1:52222` by
default) and click **Connect**.

The extension only requests permission to reach loopback addresses at that
point — never at install time — and only switches to the daemon if a real
health check against it succeeds. A daemon that cannot be reached is reported
as an error, never a silent fall back to your browser bookmarks.

## More

See [crates/bookmarks-but-better/README.md](../crates/bookmarks-but-better/README.md)
for the daemon itself — the HTTP API, the background-service integration for
each OS, and what `bookmarks-but-better service install` does.
