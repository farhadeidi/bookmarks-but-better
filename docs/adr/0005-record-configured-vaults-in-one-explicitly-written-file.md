---
status: accepted
---

# Record configured Vaults in one explicitly written file

The daemon gains a **Vault Registry**: the Vaults this user has configured, by
id and root directory, recorded in one file at
`$XDG_CONFIG_HOME/bookmarks-but-better/config.toml`. The same file carries the
settings a daemon needs to serve them — the port, the bind address, the UI
directory — because a registry that could not answer "where is the daemon"
would leave every command that talks to one needing a `--port` anyway. It is
written only by the `vault` commands and read only when a command asks for it
by name — `serve --from-config`, `service install --from-config`, and the
`vault` and `bookmark` commands themselves. `serve --vault …` continues to
ignore it entirely.

TOML rather than JSON, though `serde_json` is already a dependency and `toml`
is not: this is the one file in the product a person opens in an editor, and a
Windows vault path in a JSON string is `"C:\\Users\\me\\Vault"`.

This narrows, rather than abandons, the rule it replaces. The rule was that no
command may touch a directory the user did not name on that command line;
what actually mattered about it is that no directory is ever reached
implicitly, and that the set of directories the daemon may touch is auditable.
A registry keeps both: naming still happens explicitly, `vault add` is the only
thing that writes it, `vault list` is the audit, and a command that does not
say `--from-config` cannot reach a Vault the command line did not name.

Writes go to the daemon over its loopback API, not to the vault directory. The
single-writer lock (one daemon per Vault) is the invariant that makes
optimistic revisions safe, so a second writer taking the lock behind the
daemon's back would be a second cached scan and a lost update. A mutating CLI
command therefore requires a running daemon and fails with the address it
tried when there is none.

## Considered Options

- **No file — ask the running daemon.** `GET /api/v1/vaults` already answers
  "what is hosted". Rejected because it answers only while the daemon is up,
  cannot describe a Vault that is configured but not currently served, and
  gives `vault add` nothing to write to, so the CLI could report the set but
  never manage it.
- **The service definition as the configuration.** Make `service install`
  multi-Vault and read the registry back out of the installed command line.
  Rejected because it ties Vault management to having installed a service, and
  leaves anyone running `serve` by hand with no registry at all. The service
  definition remains derived from the registry, not the other way round.
- **CLI mutations that take the vault lock directly.** `Vault` already exposes
  the whole mutation API synchronously. Rejected because it works exactly when
  the daemon is not running, which is the opposite of the normal case, and
  because two writers is the one thing the lock exists to prevent.
- **Both transports, chosen automatically.** Rejected for this milestone: it
  doubles the tested surface and requires the offline and online paths to agree
  on every error, for a convenience that only applies while the daemon is down.

## Consequences

- The registry is the source of truth for `service install --from-config`, so
  a multi-Vault daemon becomes installable as a background service — which the
  single `--vault PATH` it took before made impossible.
- `vault remove` removes a registry entry and never the directory. Vault
  content is only ever deleted through an explicit bookmark or folder
  operation.
- Adding or removing a Vault still takes a daemon restart, as ADR-0001 says.
  The registry changes what the daemon will host next, not what it hosts now,
  and `vault list` shows both so the difference is visible rather than
  surprising.
- Mutating CLI commands need an HTTP client. It speaks plain HTTP/1.1 to
  loopback and never TLS, because the daemon binds loopback only.
