# bookmarks-but-better

Installs the [Bookmarks But Better](https://bookmarks.farhadeidi.com) daemon.

```sh
npx bookmarks-but-better@latest
```

That is the whole thing. It installs the daemon into a user-local directory —
no `sudo`, no administrator prompt — and then runs `bookmarks-but-better setup`,
which asks where your vault should live and which port to serve it on.

## What this package is, and is not

This package ships **no binaries**. It downloads the official installer for your
platform from the project's GitHub Release — `install.sh` on macOS and Linux,
`install.ps1` on Windows, both fixed-name release assets — verifies it against
its published SHA-256 sidecar, and runs it.

That installer is the same script the documented `curl … | bash` command runs.
It downloads the versioned daemon archive for your platform, verifies *that*
against its own checksum, unpacks it into a versioned directory and points a
`current` symlink at it.

So the install is **persistent**. `npx` is only how the installer got to your
machine; the daemon it installs lives on afterwards, on your `PATH`, and
upgrades in place the next time you run this.

## Options

Every option is passed straight through to the installer, which is where they
are implemented. There are no options of this package's own.

| Option | What it does |
| --- | --- |
| `--beta` | Install the latest prerelease instead of the latest stable release. |
| `--version <tag>` | Install exactly this release, e.g. `v4.0.0`. The installer is taken from that same release. |
| `--install-dir <dir>` | Where versions are unpacked. |
| `--bin-dir <dir>` | Where the `bookmarks-but-better` symlink is created. macOS and Linux only. |
| `--skip-setup` | Install the daemon but do not run setup afterward. |
| `-h`, `--help` | Show help. |

```sh
npx bookmarks-but-better@latest --beta
npx bookmarks-but-better@latest --version v4.0.0 --skip-setup
```

An option this platform has no equivalent for is refused before anything is
downloaded, rather than silently dropped.

## Where things end up

| | macOS / Linux | Windows |
| --- | --- | --- |
| Versions | `~/.local/share/bookmarks-but-better` | `%LOCALAPPDATA%\bookmarks-but-better` |
| On `PATH` | `~/.local/bin/bookmarks-but-better` | the install root's `current` directory |

Uninstalling is deleting the install directory and the symlink. Your vault is a
directory of Markdown files that nothing here has ever heard of.

## Not using npm?

You do not need Node.js for any of this — it is one way in, not the way in:

```sh
# macOS / Linux
curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash
```

```powershell
# Windows
irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1 | iex
```

See [docs/DAEMON.md](https://github.com/farhadeidi/bookmarks-but-better/blob/main/docs/DAEMON.md).

## License

MIT
