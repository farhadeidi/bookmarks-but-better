# bookmarks-but-better

Installs and looks after the [Bookmarks But Better](https://bookmarks.but-better.dev)
daemon on your machine.

```sh
npx bookmarks-but-better@latest
```

That is the whole first run. It downloads the official installer for your
platform from the project's GitHub Release, verifies it against its published
SHA-256, installs the daemon into a user-local directory (no `sudo`, no
administrator prompt), asks one question — where your bookmarks should live —
and installs and starts the background service. Run it again later and it is a
menu: the status, then whatever can be done about it — each problem's fix
first, then add or remove a vault, update, uninstall.

Needs Node.js 20.12 or newer. The daemon it installs does not.

## Commands

Every command asks for what it was not given, so none of the arguments below
has to be typed; `--yes` answers every question with its default, for scripts.

| Command                   | What it does                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| _(none)_                  | Installs when nothing is installed; otherwise the status and a menu of what to do.                             |
| `status`                  | What is installed, configured, running and connected, and the one command that fixes anything that is not.     |
| `install`                 | Install or update the daemon, configure the first vault, install and start the service. Updates keep every vault. |
| `uninstall`               | Stop and remove the service and the daemon. Vaults are never touched; the configuration is kept unless you say otherwise. |
| `vault list`              | The configured vaults and what is true of each.                                                                |
| `vault add [<id> <path>]` | Configure another vault and restart the service so it hosts it.                                                |
| `vault remove [<id>]`     | Drop a vault from the configuration (the directory stays) and restart the service.                             |

```sh
npx bookmarks-but-better@latest status
npx bookmarks-but-better@latest vault add work ~/Work/bookmarks
npx bookmarks-but-better@latest uninstall --purge-config
```

## Options

| Option                | Applies to  | What it does                                                            |
| --------------------- | ----------- | ----------------------------------------------------------------------- |
| `-y`, `--yes`         | everything  | Never ask; take every default. For scripts.                             |
| `--json`              | status, vault list | Machine-readable output.                                         |
| `--vault <dir>`       | install     | Where the first vault lives. Asked when left out; `~/Bookmarks` with `--yes`. |
| `--version <tag>`     | install     | Exactly this daemon release, e.g. `v4.2.0-beta.1`, instead of the one this tool was published for. |
| `--install-dir <dir>` | install     | Where daemon versions are unpacked.                                     |
| `--bin-dir <dir>`     | install     | Where the `bookmarks-but-better` symlink goes. macOS and Linux only.    |
| `--purge-config`      | uninstall   | Also remove the configuration file.                                     |

An option this platform has no equivalent for is refused before anything is
downloaded, rather than silently dropped.

## How it works

This package ships **no binaries** and reads **no bookmarks**. It does two
things: run the daemon binary's own non-interactive commands and read their
`--json` answers, and run the official `install.sh` or `install.ps1` from the
GitHub Release. The questions live here, drawn with
[`@clack/prompts`](https://github.com/bombshell-dev/clack); the daemon asks
none.

By default it installs the daemon release it was **published for** (named in
its `package.json`), so the two never drift apart on one machine; `--version`
is the explicit way to choose otherwise. The tool's own version moves
independently, so a fix here does not wait for a daemon release.

The install is **persistent**: the daemon lives on afterwards in a user-local
directory, on your `PATH`, run by a login service (a `LaunchAgent`, a systemd
user unit, or a Scheduled Task). `npx` is only how this tool got to your
machine.

## Where things end up

|            | macOS / Linux                                         | Windows                                 |
| ---------- | ----------------------------------------------------- | --------------------------------------- |
| Versions   | `~/.local/share/bookmarks-but-better`                 | `%LOCALAPPDATA%\bookmarks-but-better`   |
| On `PATH`  | `~/.local/bin/bookmarks-but-better`                   | the install root's `current` directory  |
| Configured | `~/.config/bookmarks-but-better/config.toml`          | `%USERPROFILE%\.config\bookmarks-but-better\config.toml` |

Your vaults are directories of Markdown files that this tool never writes into
beyond the one root metadata file that makes a directory a vault, and never
deletes.

## Not using npm?

You do not need Node.js for any of this — it is one way in, not the way in:

```sh
# macOS / Linux
curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash -s -- --vault ~/Bookmarks
```

```powershell
# Windows
& ([scriptblock]::Create((irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1))) -Vault "$env:USERPROFILE\Bookmarks"
```

See the [daemon documentation](https://bookmarks.but-better.dev/docs/daemon/install/).

## License

MIT
