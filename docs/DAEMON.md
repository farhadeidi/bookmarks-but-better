# The `bookmarks-but-better` daemon

The extension can point at a local `bookmarks-but-better` daemon — a small
background process that serves your bookmarks from a folder of Markdown files
instead of the browser's own bookmark store, over `127.0.0.1`/`localhost` only.

This is entirely optional — the Browser Source needs nothing on this page.
On Safari the daemon is the only option, because Safari does not expose
browser bookmarks to extensions.

## Install

```bash
# Any platform, with Node.js
npx bookmarks-but-better@latest
```

That is the guided way in: it installs the daemon, asks the one question a
first run has — where your bookmarks should live — and installs and starts the
background service. The same command is how you look after the daemon
afterwards:

```bash
npx bookmarks-but-better@latest status              # what is installed, running and connected, and what fixes it
npx bookmarks-but-better@latest install             # update; keeps every vault
npx bookmarks-but-better@latest vault add work ~/Work/bookmarks
npx bookmarks-but-better@latest vault remove work
npx bookmarks-but-better@latest uninstall
```

It reads no bookmarks and ships no binaries: it downloads the installer for
your platform from the GitHub Release, verifies it against its published
SHA-256, runs it, and afterwards drives the daemon binary's own commands. See
[ADR-0006](adr/0006-manage-the-daemon-from-an-npm-tool-and-keep-management-out-of-its-api.md).

Without Node.js, the installers do the same first run when told where the
vault lives, and never ask anything:

```bash
# macOS / Linux
curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash -s -- --vault ~/Bookmarks
```

```powershell
# Windows (PowerShell)
& ([scriptblock]::Create((irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1))) -Vault "$env:USERPROFILE\Bookmarks"
```

Left without `--vault`/`-Vault`, they install the binary and print the two
commands that finish the job. `install.sh` and `install.ps1` are release assets
under those exact names, so the script that runs is the one published alongside
the archives it installs — not whatever `main` happens to hold. The install is
persistent either way; `npx` is only how the installer got there.

Pipe into `bash`, not `sh`: the script uses `set -o pipefail`, which is a bash
builtin option, and `/bin/sh` is dash on Debian and Ubuntu.

### Choosing a release

Each installer resolves the latest **stable** release by default; `npx
bookmarks-but-better` pins the daemon release it was published for instead, so
the tool and the daemon it manages never drift apart on one machine. Version 4
is the first stable release that carries daemon builds, so a normal install now
resolves the stable archive directly.

For historical or pinned extension-only releases up to `v3.2.0`, the installer
reports the missing daemon asset and falls back to the newest prerelease that
does carry a build. The fallback is explicit, never silent:

```
resolving the latest stable release
the latest stable release (v3.2.0) ships no bookmarks-but-better daemon build for x86_64-unknown-linux-gnu
falling back to the latest prerelease — pass --version <tag> to pin a specific release
installing v4.0.0-beta.2 (version 4.0.0-beta.2)
```

The fallback is not reached for v4 or later stable releases that carry daemon
archives.

To choose explicitly rather than rely on the fallback:

| What you want | macOS / Linux | Windows | npx |
| --- | --- | --- | --- |
| The latest prerelease | `bash -s -- --beta` | `-Beta` | `install --version <its tag>` |
| One exact release | `bash -s -- --version v4.0.0` | `-Version v4.0.0` | `install --version v4.0.0` |
| The first vault and the service too | `bash -s -- --vault ~/Bookmarks` | `-Vault …` | asked, or `install --vault …` |

With `curl … | bash`, arguments go after `-s --`:

```bash
curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash -s -- --beta --vault ~/Bookmarks
```

`npx bookmarks-but-better@latest install --version v4.0.0` also pins the
*installer* to that release, so both halves come from the same place.

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
- With `--vault <dir>` / `-Vault <dir>`: record that directory in the Vault
  Registry (initializing it when it is not a vault yet), then install and
  start the background service, serving the web UI from the archive's `ui/`.
  Without it: print those two commands as the next steps. An install over a
  configured machine reinstalls the service so it runs the new binary; a
  service installed by 4.0.0, before the registry existed, first has its
  vaults recorded in the registry. Neither script ever asks a question, so
  both behave the same in a terminal, in CI and under
  `npx bookmarks-but-better`.

Uninstalling is `npx bookmarks-but-better uninstall`, or by hand:
`bookmarks-but-better service uninstall`, then delete the install directory
and the `bookmarks-but-better` symlink. Your vault is a directory of Markdown
files that stays exactly where it is; the configuration file is kept too
unless you say `--purge-config`.

## Connecting the extension

Once the daemon is running, open the extension's Settings → **Sources**, enter
the daemon's address (`127.0.0.1:52222` by default) and click **Connect**.
Every Vault the daemon hosts appears as its own source you can enable,
disable, give a browser-profile-local display label, and switch between —
Browser bookmarks stay enabled alongside them. The label is only an alias in
that browser profile; it never renames the Vault itself.

The extension only requests permission to reach loopback addresses at that
point — never at install time — and only records the connection if a real
health check against it succeeds. A daemon that cannot be reached is reported
as an error, never a silent fall back to your browser bookmarks.

## Multiple vaults in one daemon

One daemon can host several Vaults. Repeat `--vault`, giving each an id:

```bash
bookmarks-but-better serve \
  --vault reading=~/vaults/reading \
  --vault archive=~/vaults/archive
```

Ids are unique slugs (lowercase letters, digits, hyphens) and their
directories must not overlap; startup fails atomically otherwise. A plain
`--vault PATH` claims the id `default`, which is what a single-vault daemon
has always served.

Typing that out every time is optional. `bookmarks-but-better vault add`
records a vault in one configuration file, and `serve --from-config` hosts
everything in it:

```bash
bookmarks-but-better vault add reading ~/vaults/reading
bookmarks-but-better vault add archive ~/vaults/archive
bookmarks-but-better vault list
bookmarks-but-better serve --from-config
```

The everyday form is the manager's, which does the same and then reinstalls
the background service so the running daemon hosts the new set:

```bash
npx bookmarks-but-better vault add reading ~/vaults/reading
npx bookmarks-but-better vault remove archive
npx bookmarks-but-better vault list
```

The file is at `~/.config/bookmarks-but-better/config.toml` and carries the
port, the bind address and the UI directory alongside the vaults. Nothing reads
it unless you ask: `serve --vault …` ignores it entirely, and `vault list` is
what makes the configured set auditable. `vault remove` takes an entry out of
the file and never touches the directory. See
[ADR-0005](adr/0005-record-configured-vaults-in-one-explicitly-written-file.md).

The background service can host several vaults too — repeat
`bookmarks-but-better service install --vault ID=PATH`, or install what the
configuration holds with `service install --from-config`. The definition
records the paths it was given, so editing the configuration afterwards does
not change what an installed service starts until you install again — which
restarts a running service, and is what `npx bookmarks-but-better vault
add|remove` do for you.

Each Vault is a separate source with vault-scoped routes under
`/api/v1/vaults/{id}/…` (tree, search, bookmarks, folders, events, health).
`GET /api/v1/vaults` lists what is hosted. The legacy unscoped routes (`/tree`
and friends) keep working only while exactly one Vault is hosted; with more
than one they answer a stable `vault_required` error rather than picking a
hidden default. Adding or removing Vaults is a restart, by design (ADR-0001);
the daemon has no endpoint that changes what it hosts, and
`npx bookmarks-but-better vault add|remove` perform the restart.

Settings → **Sources** groups discovered Vaults under their daemon connection.
After changing the daemon's `--vault` configuration and restarting it, use
**Refresh Vaults** there to update the list. Forgetting a daemon removes the
connection and all of its discovered sources from that browser profile;
disabling one Vault keeps the connection for later.

## More

See [crates/bookmarks-but-better/README.md](../crates/bookmarks-but-better/README.md)
for the daemon itself — the HTTP API, the background-service integration for
each OS, and what `bookmarks-but-better service install` does.
