#!/usr/bin/env bash
# End-to-end regression test for install.sh, run against a fake GitHub
# release rather than the real one — so it exercises the exact release
# resolution, download, checksum-verification, unpack, symlink-swap and
# rollback logic install.sh performs in production, without depending on
# network access to GitHub or on a real release existing.
#
# The fake server speaks the three GitHub Release endpoints install.sh reads
# and nothing else: the `/releases/latest` redirect, the `/releases.atom`
# feed, and `/releases/download/<tag>/<asset>`. There is no JSON API here
# because install.sh no longer uses one.
#
# Run from the repository root: bash tests/install/smoke-test.sh
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
install_sh="$repo_root/install.sh"
repo_slug="farhadeidi/bookmarks-but-better"
exe="bookmarks-but-better"

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

# `serve/<tag>/<asset>` mirrors `/releases/download/<tag>/<asset>`.
asset_dir_for() {
  printf '%s/%s' "$serve_dir" "$1"
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$1" && sha256sum "$2" > "$2.sha256")
  else
    (cd "$1" && shasum -a 256 "$2" > "$2.sha256")
  fi
}

# The tag `/releases/latest` redirects to. GitHub's "latest" is the newest
# non-prerelease release, so only a stable tag is ever written here.
set_latest_stable() {
  printf '%s' "$1" > "$work/latest_stable"
}

# The releases Atom feed, newest first. One line per tag in, one <entry> out.
set_release_feed() {
  {
    printf '<?xml version="1.0" encoding="UTF-8"?>\n'
    printf '<feed xmlns="http://www.w3.org/2005/Atom">\n'
    for tag in "$@"; do
      printf '  <entry>\n'
      printf '    <id>tag:github.com,2008:Repository/1/%s</id>\n' "$tag"
      printf '    <link rel="alternate" type="text/html" href="http://127.0.0.1:%s/%s/releases/tag/%s"/>\n' \
        "$port" "$repo_slug" "$tag"
      printf '    <title>%s</title>\n' "$tag"
      printf '  </entry>\n'
    done
    printf '</feed>\n'
  } > "$work/releases.atom"
}

# Builds a fake daemon archive + checksum for release $1 (a tag), whose fake
# binary reports $2 when asked for --version.
build_daemon_release() {
  local tag="$1" label="$2" version name staging dir
  version="${tag#v}"
  name="$exe-$version-$target"
  staging="$work/staging/$name"
  dir=$(asset_dir_for "$tag")
  rm -rf "$staging"
  mkdir -p "$staging" "$dir"
  cat > "$staging/$exe" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "--version" ]; then echo "$exe $version ($label)"; exit 0; fi
if [ "\$1" = "setup" ]; then echo "fake setup ran"; exit 0; fi
exit 1
EOF
  chmod +x "$staging/$exe"
  echo "readme" > "$staging/README.md"
  echo "license" > "$staging/LICENSE"
  (cd "$work/staging" && tar -czf "$dir/$name.tar.gz" "$name")
  checksum "$dir" "$name.tar.gz"
}

# A release carrying only browser-extension zips and no daemon archive — the
# shape of every stable release up to and including v3.2.0, and the one a
# default install has to cope with rather than die on.
build_extension_only_release() {
  local tag="$1" dir
  dir=$(asset_dir_for "$tag")
  mkdir -p "$dir"
  echo "not a daemon" > "$dir/$exe-chrome-${tag#v}.zip"
  echo "not a daemon" > "$dir/$exe-firefox-${tag#v}.zip"
}

build_daemon_release "v4.0.0" "smoke test"
build_daemon_release "v4.1.0-beta.1" "smoke test beta"
set_latest_stable "v4.0.0"
set_release_feed "v4.1.0-beta.1" "v4.0.0"

cat > "$work/server.py" <<PYEOF
import http.server, os, posixpath
os.chdir("$work")

PREFIX = "/$repo_slug/releases"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_HEAD(self):
        self._handle(body=False)

    def do_GET(self):
        self._handle(body=True)

    def _handle(self, body):
        path = self.path.split("?", 1)[0]
        if path == PREFIX + ".atom":
            self._serve("releases.atom", body)
        elif path == PREFIX + "/latest":
            with open("latest_stable") as f:
                tag = f.read().strip()
            self.send_response(302)
            self.send_header("Location", PREFIX + "/tag/" + tag)
            self.end_headers()
        elif path.startswith(PREFIX + "/tag/"):
            # The redirect target itself; install.sh only reads the URL it
            # landed on, but it still has to be a real page.
            self.send_response(200)
            self.end_headers()
            if body:
                self.wfile.write(b"release page")
        elif path.startswith(PREFIX + "/download/"):
            rest = path[len(PREFIX + "/download/"):]
            self._serve(posixpath.join("serve", rest), body)
        else:
            self.send_response(404)
            self.end_headers()

    def _serve(self, path, body):
        # posixpath.join with an absolute or traversing component would escape
        # the fixture directory; this server only ever answers its own tests,
        # but refusing it keeps that true.
        full = os.path.realpath(path)
        if not full.startswith(os.path.realpath(".") + os.sep):
            self.send_response(404)
            self.end_headers()
            return
        try:
            with open(full, "rb") as f:
                data = f.read()
        except (FileNotFoundError, IsADirectoryError, PermissionError):
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if body:
            self.wfile.write(data)

    def log_message(self, *args):
        pass


http.server.HTTPServer(("127.0.0.1", $port), Handler).serve_forever()
PYEOF

python3 "$work/server.py" &
server_pid=$!
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$port/$repo_slug/releases.atom" >/dev/null 2>&1 && break
  sleep 0.1
done

run_install() {
  BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE="http://127.0.0.1:$port" \
  BOOKMARKS_BUT_BETTER_INSTALL_ROOT="$install_root" \
  BOOKMARKS_BUT_BETTER_BIN_DIR="$bin_dir" \
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
if [ "$("$bin_dir/$exe" --version)" = "$exe 4.0.0 (smoke test)" ]; then
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
build_daemon_release "v4.1.0" "smoke test"
set_latest_stable "v4.1.0"
set_release_feed "v4.1.0" "v4.1.0-beta.1" "v4.0.0"
if run_install; then
  ok "upgrade exits 0"
else
  bad "upgrade exits 0"
fi
if [ "$("$bin_dir/$exe" --version)" = "$exe 4.1.0 (smoke test)" ]; then
  ok "upgrade switches to the new version"
else
  bad "upgrade switches to the new version"
fi
if [ -x "$install_root/versions/4.0.0/$exe" ]; then
  ok "the previous version is kept on disk for rollback"
else
  bad "the previous version is kept on disk for rollback"
fi

# ---------------------------------------------------------------------------
# Test 3: a tampered checksum is refused, and the existing install survives.
# ---------------------------------------------------------------------------
sidecar="$(asset_dir_for v4.1.0)/$exe-4.1.0-$target.tar.gz.sha256"
cp "$sidecar" "$sidecar.bak"
echo "0000000000000000000000000000000000000000000000000000000000000000  $exe-4.1.0-$target.tar.gz" > "$sidecar"
if run_install; then
  bad "a tampered checksum is refused"
else
  ok "a tampered checksum is refused"
fi
if [ "$("$bin_dir/$exe" --version)" = "$exe 4.1.0 (smoke test)" ]; then
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
if [ "$("$bin_dir/$exe" --version)" = "$exe 4.1.0-beta.1 (smoke test beta)" ]; then
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
if [ "$("$bin_dir/$exe" --version)" = "$exe 4.1.0-beta.1 (smoke test beta)" ]; then
  ok "--version installed exactly the requested release"
else
  bad "--version installed exactly the requested release"
fi

# ---------------------------------------------------------------------------
# Test 6: a stable release that ships no daemon build at all — which is what
# every stable release up to and including v3.2.0 is, an extension-only one —
# falls back to the newest prerelease that does have one, instead of dying with
# "release vX has no asset named bookmarks-but-better-…" and installing
# nothing.
# ---------------------------------------------------------------------------
build_extension_only_release "v3.2.0"
set_latest_stable "v3.2.0"
set_release_feed "v4.1.0-beta.1" "v3.2.0"
install_root="$work/root4"
bin_dir="$work/bin4"
output="$work/fallback.log"
if run_install >"$output" 2>&1; then
  ok "a daemon-less stable release falls back instead of failing"
else
  bad "a daemon-less stable release falls back instead of failing (output: $(cat "$output"))"
fi
if [ "$("$bin_dir/$exe" --version)" = "$exe 4.1.0-beta.1 (smoke test beta)" ]; then
  ok "the fallback installs the newest prerelease that has a build"
else
  bad "the fallback installs the newest prerelease that has a build"
fi
if grep -q "falling back to the latest prerelease" "$output"; then
  ok "the fallback says so rather than installing a prerelease silently"
else
  bad "the fallback says so rather than installing a prerelease silently"
fi

# The other half of the same rule: when nothing anywhere has a build for this
# platform, that is an error, not a silent no-op.
set_release_feed "v3.2.0"
install_root="$work/root5"
bin_dir="$work/bin5"
if run_install >/dev/null 2>&1; then
  bad "no daemon build anywhere is an error"
else
  ok "no daemon build anywhere is an error"
fi
set_latest_stable "v4.1.0"
set_release_feed "v4.1.0" "v4.1.0-beta.1" "v4.0.0"

# ---------------------------------------------------------------------------
# Test 7: nothing advertises this script to a shell that cannot run it.
#
# install.sh is bash — `set -o pipefail` alone makes it so — and /bin/sh is
# dash on Debian and Ubuntu, where `curl … | sh` dies on the first line with
# "set: Illegal option -o pipefail" before it can explain itself. Every place
# that prints a copy-and-paste command therefore has to name `bash`.
# ---------------------------------------------------------------------------
advertised=$(grep -rn -- 'install\.sh | sh' \
  "$repo_root/README.md" \
  "$repo_root/docs" \
  "$repo_root/packages" \
  "$repo_root/src" \
  "$repo_root/crates" 2>/dev/null || true)
if [ -z "$advertised" ]; then
  ok "no documented command pipes install.sh into a non-bash shell"
else
  bad "install.sh is advertised as \`| sh\` somewhere it cannot run: $advertised"
fi

# ---------------------------------------------------------------------------
# Test 8: every advertised download comes from a GitHub Release.
#
# The install scripts, the archives and the checksums are all release assets.
# A copy-and-paste command that fetches an installer from a branch
# (raw.githubusercontent.com) or from the website installs whatever `main`
# happens to hold rather than what was released and checksummed.
# ---------------------------------------------------------------------------
#
# The launcher's own test suite is excluded: it asserts these strings are
# absent, so its source necessarily contains them.
off_release=$(grep -rn -e 'raw\.githubusercontent\.com' -e 'bookmarks\.farhadeidi\.com/install' \
  "$repo_root/README.md" \
  "$repo_root/docs" \
  "$repo_root/packages/bookmarks-but-better/README.md" \
  "$repo_root/packages/bookmarks-but-better/bin" \
  "$repo_root/packages/bookmarks-but-better/lib" \
  "$repo_root/install.sh" \
  "$repo_root/install.ps1" 2>/dev/null || true)
if [ -z "$off_release" ]; then
  ok "no installer is advertised from outside a GitHub Release"
else
  bad "an installer is fetched from outside a GitHub Release: $off_release"
fi

# ---------------------------------------------------------------------------
# Test 9: install.sh needs no jq.
#
# It resolves releases from the release download endpoint and the Atom feed,
# both plain text, so a machine without jq installs perfectly well. A
# reintroduced `jq` call would only fail on such a machine, which is exactly
# the machine this suite is unlikely to run on.
# ---------------------------------------------------------------------------
# Comment lines are stripped first: this file and install.sh both explain in
# prose why jq is gone, and that prose must not read as a call to it.
if grep -vE '^[[:space:]]*#' "$install_sh" \
     | grep -qE '(^|[^[:alnum:]_])jq([^[:alnum:]_]|$)'; then
  bad "install.sh reintroduced a jq dependency"
else
  ok "install.sh needs no jq"
fi

note ""
note "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
