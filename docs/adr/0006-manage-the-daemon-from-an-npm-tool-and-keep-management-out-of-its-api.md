---
status: accepted
---

# Manage the daemon from an npm-delivered tool, and keep management out of the daemon's API

Two things must happen outside a browser: installing the daemon, and diagnosing it when it is not running (a web app can show nothing then). The Vault Registry (ADR-0005) is a file read at startup, so configuring Vaults is also outside the daemon. All three live in one **Daemon Manager**, delivered as `npx bookmarks-but-better`, with exactly this surface: `status`, `install` (idempotent, so it is also update, and it asks for the first Vault), `uninstall`, and `vault add|remove|list`. Run with no command it installs when nothing is installed, and otherwise reports status and offers what can be done about it; every command asks for what it was not given, and `--yes` answers with the defaults. It reads or changes no bookmarks; that is what Clients are for.

The daemon binary keeps its non-interactive commands (`serve`, `init`, `doctor`, `rescan`, `vault …`, `service …`) as the plumbing the manager calls; the ones a program reads (`vault list`, `service status`) answer in JSON, and none of them asks a question or draws on a terminal. The daemon's HTTP API stays read-only about configuration — `GET /vaults` says what is hosted, nothing adds or removes a Vault — and a registry change is followed by a service restart that the manager performs. The Daemon Web App learns what is hosted from `GET /vaults` and nothing about what is configured; the difference between the two is the manager's `status` to report.

## Considered Options

- **Vault management in the web app, over new daemon endpoints.** Rejected on three counts. The daemon has no authentication; its safety is loopback, the `Host` guard, and the fact that it only ever touches directories the user named on a command line — an endpoint that points it at an arbitrary path is a different class of risk. Hosting a Vault at runtime contradicts ADR-0001's atomic startup and would put lock, watcher and subscriber lifecycle into the core. And a browser cannot hand over a filesystem path: a folder picker yields a handle, so the interface degrades to a typed path with no completion, or to a directory-listing endpoint that exposes the filesystem over HTTP.
- **The whole interface in the daemon binary: prompts, a menu, a REPL, a full-screen view.** Built on a branch and withdrawn: about five thousand lines and three terminal libraries, in the one binary that must also run as a login service, to reproduce what the web app already draws.
- **The whole tool in TypeScript, `serve` included.** Rejected because the login service cannot depend on Node being installed, and the vault format lives in Rust.
- **No command-line tool; a native installer or tray app.** Rejected as several times the work of a CLI for the same job, and Safari, being daemon-only, needs the tool regardless.

## Consequences

- The npm package joins the one-version rule and installs exactly its own daemon version, so the daemon binary's JSON output is a contract versioned with it and needs no separate compatibility story.
- `curl … | bash` remains the headless install, and the manager drives that same script. Given `--vault <dir>` it records the Vault (initializing it), installs the service and starts it; given nothing it installs the binary and prints the next steps, naming `npx`. It never asks. The daemon binary's interactive `setup` goes away with it.
- Reading and changing bookmarks from a terminal is out of scope. If it is ever wanted it is a Client over the HTTP API, not a manager command, and not a daemon command.
- The daemon's health response carries `clients`, the number of open event streams, so `status` can say whether a browser is connected. It never gains a management endpoint.
- `service install` is the one way a change is applied — a new binary, a new port, a different set of Vaults — so it restarts a running service rather than leaving it on its old command line.
