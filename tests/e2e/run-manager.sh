#!/usr/bin/env bash
# The Daemon Manager (`npx bookmarks-but-better`) end to end, on this machine,
# against the daemon built from this checkout — with no GitHub release, no
# published npm package, and no effect on a real install.
#
#   bun run test:e2e:manager     # the scripted first run, with assertions
#   bun run try:manager          # the same setup, then a shell with `bbb` on PATH
#
# What it sets up: a debug build of the daemon packed as a fake release under
# the manager's own version, served by a local HTTP server; and a throwaway
# HOME, so the registry, the service definition and the vault all land in a
# temp directory that is removed on exit. One thing is real: the background
# service is loaded under the product's own label for the duration, because a
# service manager has one namespace per user. The script refuses to start while
# a real one is loaded, uses a port that is never the product default, and
# unloads its own service on exit.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cargo=${CARGO:-"$HOME/.cargo/bin/cargo"}
mode="run"
[[ "${1:-}" == "--shell" ]] && mode="shell"

# Never the product default (52222): a run must not collide with a real daemon.
port=${BOOKMARKS_BUT_BETTER_E2E_PORT:-52224}
label="com.farhadeidi.bookmarks"

case "$(uname -s)" in
  Darwin) os="apple-darwin" ;;
  Linux) os="unknown-linux-gnu" ;;
  *) echo "this runner supports macOS and Linux" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch="x86_64" ;;
  arm64|aarch64) arch="aarch64" ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
target="$arch-$os"

if [[ "$os" == "apple-darwin" ]] && launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  echo "a real $label agent is loaded; stop it first: bookmarks-but-better service stop" >&2
  exit 1
fi
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $port is busy; set BOOKMARKS_BUT_BETTER_E2E_PORT to another" >&2
  exit 1
fi

# Built before HOME moves: cargo keeps its registry under the real one.
cd "$repo_root"
"$cargo" build --locked --package bookmarks-but-better --bin bookmarks-but-better
version=$(node -p 'require("./packages/bookmarks-but-better/package.json").version')
tag="v$version"

root=$(mktemp -d)
export HOME="$root/home"
export XDG_CONFIG_HOME="$HOME/.config"
export BOOKMARKS_BUT_BETTER_BIN_DIR="$root/bin"
mkdir -p "$HOME" "$XDG_CONFIG_HOME/bookmarks-but-better"
# The service takes its port from the registry, which `vault add` preserves.
printf 'port = %s\n' "$port" > "$XDG_CONFIG_HOME/bookmarks-but-better/config.toml"

cleanup() {
  if [[ -x "$root/install/current/bookmarks-but-better" ]]; then
    "$root/install/current/bookmarks-but-better" service uninstall >/dev/null 2>&1 || true
  fi
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$root"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# The fake release: the archive install.sh expects for this platform, its
# checksum, and install.sh itself, under the exact GitHub Release paths.
# ---------------------------------------------------------------------------
name="bookmarks-but-better-$version-$target"
serve="$root/farhadeidi/bookmarks-but-better/releases/download/$tag"
staging="$root/staging/$name"
mkdir -p "$serve" "$staging/ui"
cp target/debug/bookmarks-but-better "$staging/"
if [[ -f dist-daemon/index.html ]]; then
  cp -R dist-daemon/. "$staging/ui/"
else
  echo '<!doctype html><title>Bookmarks But Better</title>' > "$staging/ui/index.html"
fi
(cd "$root/staging" && tar -czf "$serve/$name.tar.gz" "$name")
cp install.sh "$serve/install.sh"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$serve" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256" && sha256sum install.sh > install.sh.sha256)
else
  (cd "$serve" && shasum -a 256 "$name.tar.gz" > "$name.tar.gz.sha256" && shasum -a 256 install.sh > install.sh.sha256)
fi

http_port=$(( (RANDOM % 5000) + 20000 ))
(cd "$root" && exec python3 -m http.server "$http_port" --bind 127.0.0.1 >/dev/null 2>&1) &
server_pid=$!
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$http_port/" >/dev/null 2>&1 && break
  sleep 0.1
done
export BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE="http://127.0.0.1:$http_port"

# `bbb`: the manager from this checkout, pointed at the throwaway install.
mkdir -p "$root/shim"
cat > "$root/shim/bbb" <<EOF
#!/usr/bin/env bash
exec node "$repo_root/packages/bookmarks-but-better/bin/bookmarks-but-better.mjs" "\$@" --install-dir "$root/install"
EOF
chmod +x "$root/shim/bbb"
export PATH="$root/shim:$PATH"

if [[ "$mode" == "shell" ]]; then
  cat <<EOF

Throwaway home:   $HOME
Fake release:     $tag from $BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE
Service port:     $port

  bbb                        # nothing is installed yet: asks where the vault goes, installs, starts the service
  bbb status
  bbb vault add work ~/Work
  bbb vault remove work
  bbb uninstall

Exit this shell to tear everything down.

EOF
  "${SHELL:-bash}" -i || true
  exit 0
fi

# ---------------------------------------------------------------------------
# The scripted first run.
# ---------------------------------------------------------------------------
fail() { echo "NOT OK - $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
health() { curl -fsS "http://127.0.0.1:$port/api/v1/health" 2>/dev/null || true; }

step "no command, nothing installed, --yes: install, ask nothing, start the service"
bbb --yes
[[ "$(health)" == *'"id":"default"'* ]] || fail "the daemon does not host the default vault: $(health)"

step "status"
bbb status | tee "$root/status.txt"
grep -q "everything is in place" "$root/status.txt" || fail "status reports a problem"

step "vault add, which restarts the service"
mkdir -p "$root/work"
bbb vault add work "$root/work" --yes
[[ "$(health)" == *'"id":"work"'* ]] || fail "the daemon does not host the added vault: $(health)"

step "vault remove"
bbb vault remove work --yes
[[ "$(health)" != *'"id":"work"'* ]] || fail "the daemon still hosts the removed vault"
[[ -d "$root/work" ]] || fail "vault remove deleted the directory"

step "uninstall: service and daemon go, vault and configuration stay"
bbb uninstall --yes
[[ ! -e "$root/install" ]] || fail "the install directory remains"
[[ -f "$XDG_CONFIG_HOME/bookmarks-but-better/config.toml" ]] || fail "the configuration was removed"
[[ -f "$HOME/Bookmarks/.bookmarks-but-better-folder.md" ]] || fail "the vault was touched"
if [[ "$os" == "apple-darwin" ]] && launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1; then
  fail "the service is still loaded"
fi

echo
echo "ok - the manager installed, reported, changed vaults and uninstalled cleanly"
