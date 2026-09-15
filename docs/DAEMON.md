# The `bookmarks-but-better` daemon — contributor reference

> **Users:** install, connection, multiple vaults, backups, troubleshooting and
> uninstall are documented at
> <https://bookmarks.but-better.dev/docs/daemon/install/>. This file is the
> contributor and agent reference for how those pieces work.

The daemon serves Markdown Vaults to clients over `127.0.0.1`/`localhost` only.
It is optional for the Browser Source; on Safari it is the only source, because
Safari exposes no bookmarks API to extensions (ADR-0004). The daemon itself —
HTTP API, background-service integration per OS, format guarantees — is
documented in
[crates/bookmarks-but-better/README.md](../crates/bookmarks-but-better/README.md).

## The Daemon Manager

`npx bookmarks-but-better` (`packages/bookmarks-but-better`) is the Daemon
Manager: `status`, `install`, `uninstall`, `vault add|remove|list`. It reads no
bookmarks and ships no binaries. It downloads the installer for the platform
from the GitHub Release, verifies it against its published SHA-256 sidecar, runs
it, and afterwards drives the daemon binary's own non-interactive commands and
reads their `--json` answers. Every question lives in the manager; the binary
and the install scripts ask none. See
[ADR-0006](adr/0006-manage-the-daemon-from-an-npm-tool-and-keep-management-out-of-its-api.md).

- It pins the daemon release named by `daemon.version` in its `package.json`
  (the installer is fetched from that tag too), so the tool and the daemon it
  manages never drift apart on one machine. `install --version <tag>` pins both
  halves — the installer script and the archive — to that release.
- `vault add|remove` edit the Vault Registry through the binary, then reinstall
  the service with `service install --from-config --ui-dir <install>/current/ui`,
  which restarts it. Removing the last vault uninstalls the service instead,
  since a service with nothing to serve would fail at every login.
- `uninstall` runs `service uninstall`, deletes the install root and the
  `bookmarks-but-better` symlink (or, on Windows, removes `current` from the
  user `Path`), and keeps the configuration file unless `--purge-config`.

## Install scripts

```bash
# macOS / Linux
curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash -s -- --vault ~/Bookmarks
```

```powershell
# Windows (PowerShell)
& ([scriptblock]::Create((irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1))) -Vault "$env:USERPROFILE\Bookmarks"
```

`install.sh` and `install.ps1` are release assets under those exact names, so
the script that runs is the one published alongside the archives it installs —
not whatever `main` happens to hold. The install is persistent either way;
`npx` is only how the installer got there.

Pipe into `bash`, not `sh`: the script uses `set -o pipefail`, which is a bash
builtin option, and `/bin/sh` is dash on Debian and Ubuntu.

### What the install scripts do

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
  Registry as `default` (initializing it when it is not a vault yet; skipped
  when a vault is already configured), then install and start the background
  service, serving the web UI from the archive's `ui/`. Without it: print those
  two commands as the next steps. An install over a configured machine
  reinstalls the service so it runs the new binary; a service installed by
  4.0.0, before the registry existed, first has its vaults recorded in the
  registry. Neither script ever asks a question, so both behave the same in a
  terminal, in CI and under `npx bookmarks-but-better`.

### Release resolution

Each installer resolves the latest **stable** release by default; `npx
bookmarks-but-better` pins the daemon release it was published for instead.
Version 4 is the first stable release that carries daemon builds, so a normal
install resolves the stable archive directly.

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

| What you want                       | macOS / Linux                    | Windows           | npx                           |
| ----------------------------------- | -------------------------------- | ----------------- | ----------------------------- |
| The latest prerelease               | `bash -s -- --beta`              | `-Beta`           | `install --version <its tag>` |
| One exact release                   | `bash -s -- --version v4.0.0`    | `-Version v4.0.0` | `install --version v4.0.0`    |
| The first vault and the service too | `bash -s -- --vault ~/Bookmarks` | `-Vault …`        | asked, or `install --vault …` |

With `curl … | bash`, arguments go after `-s --`.

Uninstalling by hand: `bookmarks-but-better service uninstall`, then delete the
install directory and the `bookmarks-but-better` symlink. The vault directory
is never touched; the configuration file is kept unless removed explicitly.

## Extension connection

Settings → **Sources** (and the setup wizard's **Local vault** step) take the
daemon's address (`127.0.0.1:52222` by default) and **Connect**. Every Vault the
daemon hosts becomes its own source that can be enabled, disabled, given a
browser-profile-local display label, and switched between — Browser bookmarks
stay enabled alongside them. The label is only an alias in that browser
profile; it never renames the Vault itself.

- The extension requests the optional loopback host permission at Connect —
  never at install time — and only records the connection if a real health
  check against it succeeds (`src/browser/daemon/connect.ts`).
- A daemon that cannot be reached is reported as an error, never a silent fall
  back to browser bookmarks (ADR-0003).
- Settings → **Sources** groups discovered Vaults under their daemon
  connection. Discovery happens at connect and on **Refresh Vaults**; the
  extension does not learn about a registry change on its own. Forgetting a
  daemon removes the connection and all of its discovered sources from that
  browser profile; disabling one Vault keeps the connection for later.

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

`bookmarks-but-better vault add` records a vault in the Vault Registry, and
`serve --from-config` hosts everything in it:

```bash
bookmarks-but-better vault add reading ~/vaults/reading
bookmarks-but-better vault add archive ~/vaults/archive
bookmarks-but-better vault list
bookmarks-but-better serve --from-config
```

The registry is `$XDG_CONFIG_HOME/bookmarks-but-better/config.toml`
(`~/.config/…` when unset, on every platform) and carries the port, the bind
address and the UI directory alongside the vaults. Nothing reads it unless
asked: `serve --vault …` ignores it entirely, and `vault list` is what makes the
configured set auditable. `vault remove` takes an entry out of the file and
never touches the directory. See
[ADR-0005](adr/0005-record-configured-vaults-in-one-explicitly-written-file.md).

The background service can host several vaults too — repeat
`bookmarks-but-better service install --vault ID=PATH`, or install what the
registry holds with `service install --from-config`. The definition records the
paths it was given, so editing the registry afterwards does not change what an
installed service starts until it is installed again — which restarts a running
service, and is what `npx bookmarks-but-better vault add|remove` do.

### HTTP routes

Each Vault is a separate source with vault-scoped routes under
`/api/v1/vaults/{id}/…` (tree, search, bookmarks, folders, events, health).
`GET /api/v1/vaults` lists what is hosted. The legacy unscoped routes (`/tree`
and friends) keep working only while exactly one Vault is hosted; with more
than one they answer a stable `vault_required` error (400) rather than picking a
hidden default. Adding or removing Vaults is a restart, by design (ADR-0001);
the daemon has no endpoint that changes what it hosts, and
`npx bookmarks-but-better vault add|remove` perform the restart. The full
contract is in the crate README.
