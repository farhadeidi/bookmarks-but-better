#!/usr/bin/env bash
# End-to-end regression test for install.sh, run against a fake GitHub
# release rather than the real one — so it exercises the exact download,
# checksum-verification, unpack, symlink-swap and rollback logic install.sh
# performs in production, without depending on network access to GitHub or on
# a real release existing.
#
# Run from the repository root: bash tests/install/smoke-test.sh
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
install_sh="$repo_root/install.sh"

work=$(mktemp -d)
port=$(( (RANDOM % 5000) + 20000 ))
server_pid=""

pass=0
fail=0

note() { printf '%s\n' "$*" >&2; }
ok() { pass=$((pass + 1)); note "ok - $*"; }
bad() { fail=$((fail + 1)); note "NOT OK - $*"; }

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# The target this machine's install.sh will actually ask for, computed the
# same way install.sh computes it, so the fixture always matches whatever CI
# runner this executes on.
# ---------------------------------------------------------------------------
case "$(uname -s)" in
  Linux) os="unknown-linux-gnu" ;;
  Darwin) os="apple-darwin" ;;
  *) echo "unsupported test host OS" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch="x86_64" ;;
  arm64|aarch64) arch="aarch64" ;;
  *) echo "unsupported test host architecture" >&2; exit 1 ;;
esac
target="${arch}-${os}"

serve_dir="$work/serve"
mkdir -p "$serve_dir"

# Builds a fake release archive+checksum for $1 (a version string) and writes
# a releases_latest.json fixture naming it as the current stable release.
build_release() {
  local version="$1" name staging
  name="bbb-$version-$target"
  staging="$work/staging/$name"
  rm -rf "$staging"
  mkdir -p "$staging"
  cat > "$staging/bbb" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then echo "bbb $version (smoke test)"; exit 0; fi
if [ "\$1" = "setup" ]; then echo "fake setup ran"; exit 0; fi
exit 1
EOF
  chmod +x "$staging/bbb"
  echo "readme" > "$staging/README.md"
  echo "license" > "$staging/LICENSE"
  (cd "$work/staging" && tar -czf "$serve_dir/$name.tar.gz" "$name")
  (cd "$serve_dir" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")

  cat > "$work/releases_latest.json" <<EOF
{
  "tag_name": "v$version",
  "prerelease": false,
  "draft": false,
  "assets": [
    {"name": "$name.tar.gz", "browser_download_url": "http://127.0.0.1:$port/asset/$name.tar.gz"},
    {"name": "$name.tar.gz.sha256", "browser_download_url": "http://127.0.0.1:$port/asset/$name.tar.gz.sha256"}
  ]
}
EOF
}

# A fake prerelease, listed alongside the stable one so --beta has something
# to pick that a plain stable install would never resolve to.
build_beta_release() {
  local version="$1" name staging
  name="bbb-$version-$target"
  staging="$work/staging/$name"
  rm -rf "$staging"
  mkdir -p "$staging"
  cat > "$staging/bbb" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then echo "bbb $version (smoke test beta)"; exit 0; fi
exit 1
EOF
  chmod +x "$staging/bbb"
  echo readme > "$staging/README.md"
  echo license > "$staging/LICENSE"
  (cd "$work/staging" && tar -czf "$serve_dir/$name.tar.gz" "$name")
  (cd "$serve_dir" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")

  cat > "$work/release_beta_single.json" <<EOF
{
  "tag_name": "v$version",
  "prerelease": true,
  "draft": false,
  "assets": [
    {"name": "$name.tar.gz", "browser_download_url": "http://127.0.0.1:$port/asset/$name.tar.gz"},
    {"name": "$name.tar.gz.sha256", "browser_download_url": "http://127.0.0.1:$port/asset/$name.tar.gz.sha256"}
  ]
}
EOF
  cat > "$work/releases_list.json" <<EOF
[$(cat "$work/release_beta_single.json")]
EOF
}

build_release "4.0.0"
build_beta_release "4.1.0-beta.1"

cat > "$work/server.py" <<PYEOF
import http.server, os
os.chdir("$work")

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.endswith("/releases/latest"):
            self._serve("releases_latest.json")
        elif self.path.endswith("/releases?per_page=20"):
            self._serve("releases_list.json")
        elif "/releases/tags/" in self.path:
            # This fixture only ever names one explicit tag across the whole
            # suite, so every tag lookup can safely resolve to it.
            self._serve("release_beta_single.json")
        elif self.path.startswith("/asset/"):
            self._serve(os.path.join("serve", self.path[len("/asset/"):]))
        else:
            self.send_response(404); self.end_headers()

    def _serve(self, path):
        try:
            with open(path, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(404); self.end_headers()

    def log_message(self, *args):
        pass

http.server.HTTPServer(("127.0.0.1", $port), Handler).serve_forever()
PYEOF

python3 "$work/server.py" &
server_pid=$!
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$port/releases_latest.json" >/dev/null 2>&1 && break
  sleep 0.1
done

run_install() {
  BBB_INSTALL_GITHUB_API="http://127.0.0.1:$port" \
  BBB_INSTALL_ROOT="$install_root" \
  BBB_BIN_DIR="$bin_dir" \
  bash "$install_sh" --skip-setup "$@"
}

# ---------------------------------------------------------------------------
# Test 1: a fresh install.
# ---------------------------------------------------------------------------
install_root="$work/root1"
bin_dir="$work/bin1"
if run_install; then
  ok "fresh install exits 0"
else
  bad "fresh install exits 0"
fi
if [ "$("$bin_dir/bbb" --version)" = "bbb 4.0.0 (smoke test)" ]; then
  ok "installed binary reports the expected version"
else
  bad "installed binary reports the expected version"
fi
if [ "$(readlink "$install_root/current")" = "$install_root/versions/4.0.0" ]; then
  ok "current points at the installed version"
else
  bad "current points at the installed version"
fi

# ---------------------------------------------------------------------------
# Test 2: upgrade keeps the previous version and swaps current.
# ---------------------------------------------------------------------------
build_release "4.1.0"
if run_install; then
  ok "upgrade exits 0"
else
  bad "upgrade exits 0"
fi
if [ "$("$bin_dir/bbb" --version)" = "bbb 4.1.0 (smoke test)" ]; then
  ok "upgrade switches to the new version"
else
  bad "upgrade switches to the new version"
fi
if [ -x "$install_root/versions/4.0.0/bbb" ]; then
  ok "the previous version is kept on disk for rollback"
else
  bad "the previous version is kept on disk for rollback"
fi

# ---------------------------------------------------------------------------
# Test 3: a tampered checksum is refused, and the existing install survives.
# ---------------------------------------------------------------------------
sidecar="$serve_dir/bbb-4.1.0-$target.tar.gz.sha256"
cp "$sidecar" "$sidecar.bak"
echo "0000000000000000000000000000000000000000000000000000000000000000  bbb-4.1.0-$target.tar.gz" > "$sidecar"
if run_install; then
  bad "a tampered checksum is refused"
else
  ok "a tampered checksum is refused"
fi
if [ "$("$bin_dir/bbb" --version)" = "bbb 4.1.0 (smoke test)" ]; then
  ok "the existing install is untouched after a refused upgrade"
else
  bad "the existing install is untouched after a refused upgrade"
fi
mv "$sidecar.bak" "$sidecar"

# ---------------------------------------------------------------------------
# Test 4: --beta installs the prerelease, never the stable one.
# ---------------------------------------------------------------------------
install_root="$work/root2"
bin_dir="$work/bin2"
if run_install --beta; then
  ok "--beta install exits 0"
else
  bad "--beta install exits 0"
fi
if [ "$("$bin_dir/bbb" --version)" = "bbb 4.1.0-beta.1 (smoke test beta)" ]; then
  ok "--beta installs the prerelease, not the stable release"
else
  bad "--beta installs the prerelease, not the stable release"
fi

# ---------------------------------------------------------------------------
# Test 5: --version pins an exact release.
# ---------------------------------------------------------------------------
install_root="$work/root3"
bin_dir="$work/bin3"
if run_install --version v4.1.0-beta.1; then
  ok "--version pins the requested release"
else
  bad "--version pins the requested release"
fi
if [ "$("$bin_dir/bbb" --version)" = "bbb 4.1.0-beta.1 (smoke test beta)" ]; then
  ok "--version installed exactly the requested release"
else
  bad "--version installed exactly the requested release"
fi

# ---------------------------------------------------------------------------
# Test 6: nothing advertises this script to a shell that cannot run it.
#
# install.sh is bash — `set -o pipefail` alone makes it so — and /bin/sh is
# dash on Debian and Ubuntu, where `curl … | sh` dies on the first line with
# "set: Illegal option -o pipefail" before it can explain itself. Every place
# that prints a copy-and-paste command therefore has to name `bash`.
# ---------------------------------------------------------------------------
advertised=$(grep -rn -- 'install\.sh | sh' \
  "$repo_root/README.md" \
  "$repo_root/docs" \
  "$repo_root/src" \
  "$repo_root/crates" 2>/dev/null || true)
if [ -z "$advertised" ]; then
  ok "no documented command pipes install.sh into a non-bash shell"
else
  bad "install.sh is advertised as \`| sh\` somewhere it cannot run: $advertised"
fi

note ""
note "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
