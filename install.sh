#!/usr/bin/env bash
# Installs (or upgrades) the `bbb` daemon for the current user — no sudo, no
# system-wide anything — then runs `bbb setup`.
#
# Usage — `bash`, not `sh`: `set -o pipefail` below is a bash builtin option,
# and /bin/sh is dash on Debian and Ubuntu, where piping this into `sh` dies on
# that line with "set: Illegal option -o pipefail" before it can say why.
#
#   curl -fsSL https://raw.githubusercontent.com/farhadeidi/bookmarks-but-better/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --beta
#   curl -fsSL .../install.sh | bash -s -- --version v4.0.0-beta.1
#
# Every release is a GitHub Release built by .github/workflows/release.yml,
# which uploads one archive and one .sha256 checksum per platform (see that
# file for exactly what is in each archive). This script:
#
#   1. Resolves which release to install: the latest *stable* release by
#      default, or the latest (or a named) prerelease with --beta /
#      --version. Until the daemon has a stable release, the latest stable
#      release is an extension-only one carrying no `bbb` archive at all; when
#      that is what the default resolves to, this falls back to the latest
#      prerelease that does have a build for this platform, and says so.
#   2. Downloads that platform's archive and its .sha256 sidecar, and refuses
#      to install unless the archive's hash matches it.
#   3. Unpacks into a versioned directory under $BBB_INSTALL_ROOT and only
#      then repoints a `current` symlink at it — so a failed download or a
#      binary that won't even run leaves whatever was already installed
#      completely untouched, and an install that got this far can always be
#      rolled back to the version the symlink pointed at before.
#   4. Symlinks `bbb` on $BBB_BIN_DIR, and finally runs `bbb setup`.
#
# Nothing here touches a vault. Uninstalling is: remove $BBB_INSTALL_ROOT and
# $BBB_BIN_DIR/bbb; your vault, wherever you pointed `bbb setup` at, is a
# directory of Markdown files this script has never heard of.
set -euo pipefail

REPO="farhadeidi/bookmarks-but-better"
# Overridable only for this script's own test suite — there is no supported
# reason to point it anywhere but the real API in normal use.
API_BASE="${BBB_INSTALL_GITHUB_API:-https://api.github.com}"
INSTALL_ROOT="${BBB_INSTALL_ROOT:-$HOME/.local/share/bbb}"
BIN_DIR="${BBB_BIN_DIR:-$HOME/.local/bin}"
CHANNEL="stable"
EXPLICIT_VERSION=""
SKIP_SETUP=0

log()  { printf '%s\n' "$*" >&2; }
die()  { log "error: $*"; exit 1; }

usage() {
  cat <<'USAGE'
Usage: install.sh [options]

Options:
  --beta                Install the latest prerelease instead of the latest
                        stable release.
  --version <tag>       Install exactly this release, e.g. v4.0.0 or
                        v4.0.0-beta.1 (with or without the leading "v").
                        Overrides --beta.
  --install-dir <dir>   Where versions are unpacked. Default: ~/.local/share/bbb
                        (or $BBB_INSTALL_ROOT).
  --bin-dir <dir>       Where the `bbb` symlink is created. Default:
                        ~/.local/bin (or $BBB_BIN_DIR).
  --skip-setup          Install the binary but do not run `bbb setup`
                        afterward.
  -h, --help            Show this help.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --beta) CHANNEL="beta"; shift ;;
    --version)
      [ $# -ge 2 ] || die "--version needs an argument"
      EXPLICIT_VERSION="$2"
      shift 2
      ;;
    --install-dir)
      [ $# -ge 2 ] || die "--install-dir needs an argument"
      INSTALL_ROOT="$2"
      shift 2
      ;;
    --bin-dir)
      [ $# -ge 2 ] || die "--bin-dir needs an argument"
      BIN_DIR="$2"
      shift 2
      ;;
    --skip-setup) SKIP_SETUP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unrecognized argument: $1 (see --help)" ;;
  esac
done

for tool in curl tar; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required but was not found"
done
command -v jq >/dev/null 2>&1 || die "jq is required but was not found"
if command -v sha256sum >/dev/null 2>&1; then
  CHECKSUM_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  CHECKSUM_CMD="shasum -a 256"
else
  die "neither sha256sum nor shasum was found; cannot verify the download"
fi

# ---------------------------------------------------------------------------
# 1. Platform detection: OS and architecture to a released target triple.
# ---------------------------------------------------------------------------
os_name=$(uname -s)
arch_name=$(uname -m)

case "$os_name" in
  Linux) os="unknown-linux-gnu" ;;
  Darwin) os="apple-darwin" ;;
  *) die "unsupported OS: $os_name (this script installs on Linux and macOS; see install.ps1 for Windows)" ;;
esac

case "$arch_name" in
  x86_64|amd64) arch="x86_64" ;;
  arm64|aarch64) arch="aarch64" ;;
  *) die "unsupported architecture: $arch_name" ;;
esac

TARGET="${arch}-${os}"
log "platform: $TARGET"

# ---------------------------------------------------------------------------
# 2. Which release: an explicit tag, the latest prerelease, or the latest
#    stable release. Stable is the default; a prerelease always has to be
#    asked for, one way or another.
# ---------------------------------------------------------------------------
api_get() {
  local url="$1"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL -H "Authorization: token $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$url"
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "$url"
  fi
}

# The archive this platform needs from a given release. Every release names it
# after its own version, so this can only be computed per release — which is
# exactly why the fallback below has to look inside each candidate rather than
# just taking the newest thing it finds.
archive_name_for() {
  printf 'bbb-%s-%s.tar.gz' "${1#v}" "$TARGET"
}

# True when a release actually ships a daemon build for this platform. An
# extension-only release (every stable release up to and including v3.2.0) does
# not, and installing from one is not a thing that can succeed.
release_has_daemon() {
  local json="$1" release_tag
  release_tag=$(printf '%s' "$json" | jq -r '.tag_name // ""')
  [ -n "$release_tag" ] && [ "$release_tag" != "null" ] || return 1
  printf '%s' "$json" \
    | jq -e --arg name "$(archive_name_for "$release_tag")" \
        '[.assets[]?.name] | index($name) != null' >/dev/null
}

release_json=""
if [ -n "$EXPLICIT_VERSION" ]; then
  tag="${EXPLICIT_VERSION#v}"
  tag="v${tag}"
  log "resolving explicit release $tag"
  release_json=$(api_get "$API_BASE/repos/$REPO/releases/tags/$tag") \
    || die "no release found for tag $tag"
elif [ "$CHANNEL" = "beta" ]; then
  log "resolving the latest prerelease"
  release_json=$(api_get "$API_BASE/repos/$REPO/releases?per_page=20") \
    || die "could not list releases"
  release_json=$(printf '%s' "$release_json" | jq -c '[.[] | select(.draft == false and .prerelease == true)] | first')
  [ "$release_json" != "null" ] || die "no prerelease was found; pass --version to install a specific one"
else
  log "resolving the latest stable release"
  release_json=$(api_get "$API_BASE/repos/$REPO/releases/latest") \
    || die "could not fetch the latest release"

  # The daemon has no stable release yet: the latest stable release is an
  # extension-only one, and resolving to it is how `curl … | bash` ends in
  # "release vX has no asset named bbb-…". Fall back to the newest prerelease
  # that does carry a build for this platform, loudly — a prerelease is
  # normally something you have to ask for, and this is the one case where the
  # alternative is not installing at all.
  if ! release_has_daemon "$release_json"; then
    stable_tag=$(printf '%s' "$release_json" | jq -r '.tag_name // "unknown"')
    log "the latest stable release ($stable_tag) ships no bbb daemon build for $TARGET"
    log "falling back to the latest prerelease — pass --version <tag> to pin a specific release"
    releases_json=$(api_get "$API_BASE/repos/$REPO/releases?per_page=20") \
      || die "could not list releases"
    release_json=$(printf '%s' "$releases_json" | jq -c --arg target "$TARGET" '
      [ .[]
        | select(.draft == false and .prerelease == true)
        | select(. as $release | .assets | any(
            .name == ("bbb-" + ($release.tag_name | ltrimstr("v")) + "-" + $target + ".tar.gz")))
      ] | first')
    if [ -z "$release_json" ] || [ "$release_json" = "null" ]; then
      die "no stable or prerelease release has a bbb build for $TARGET yet"
    fi
  fi
fi

tag=$(printf '%s' "$release_json" | jq -r '.tag_name')
if [ -z "$tag" ] || [ "$tag" = "null" ]; then
  die "the resolved release had no tag"
fi
version="${tag#v}"
log "installing $tag (version $version)"

archive_name=$(archive_name_for "$tag")
archive_url=$(printf '%s' "$release_json" | jq -r --arg name "$archive_name" '.assets[] | select(.name == $name) | .browser_download_url')
checksum_url=$(printf '%s' "$release_json" | jq -r --arg name "$archive_name.sha256" '.assets[] | select(.name == $name) | .browser_download_url')

if [ -z "$archive_url" ] || [ "$archive_url" = "null" ]; then
  die "release $tag has no asset named $archive_name"
fi
if [ -z "$checksum_url" ] || [ "$checksum_url" = "null" ]; then
  die "release $tag has no checksum for $archive_name"
fi

# ---------------------------------------------------------------------------
# 3. Download and verify. Nothing below this point is installed until the
#    hash matches.
# ---------------------------------------------------------------------------
work_dir=$(mktemp -d)
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

log "downloading $archive_name"
curl -fsSL -o "$work_dir/$archive_name" "$archive_url"
curl -fsSL -o "$work_dir/$archive_name.sha256" "$checksum_url"

log "verifying checksum"
(cd "$work_dir" && $CHECKSUM_CMD -c "$archive_name.sha256") \
  || die "checksum verification failed for $archive_name — refusing to install a corrupted or tampered download"

# ---------------------------------------------------------------------------
# 4. Unpack into a fresh versioned directory. The version already installed
#    (if any) is completely untouched by everything up to and including this
#    step.
# ---------------------------------------------------------------------------
extract_dir="$work_dir/extracted"
mkdir -p "$extract_dir"
tar -xzf "$work_dir/$archive_name" -C "$extract_dir"

staged="$extract_dir/bbb-$version-$TARGET"
[ -x "$staged/bbb" ] || die "the archive did not contain an executable bbb — this is a packaging bug, not a local problem"

"$staged/bbb" --version >/dev/null 2>&1 \
  || die "the downloaded bbb binary does not run on this machine (checked with --version)"

previous_version=""
if [ -L "$INSTALL_ROOT/current" ]; then
  previous_version=$(basename "$(readlink "$INSTALL_ROOT/current")")
fi

version_dir="$INSTALL_ROOT/versions/$version"
rm -rf "$version_dir"
mkdir -p "$(dirname "$version_dir")"
mv "$staged" "$version_dir"

# ---------------------------------------------------------------------------
# 5. Repoint `current` — the one step that changes what a running `bbb` on
#    $PATH resolves to. `-n` (`--no-dereference`, supported by both GNU and
#    BSD `ln`) replaces the symlink itself rather than, since it already
#    points at a directory, being interpreted as "put this inside that
#    directory".
# ---------------------------------------------------------------------------
ln -sfn "$version_dir" "$INSTALL_ROOT/current"

if ! "$INSTALL_ROOT/current/bbb" --version >/dev/null 2>&1; then
  if [ -n "$previous_version" ]; then
    log "the new version failed its post-install check; rolling back to $previous_version"
    ln -sfn "$INSTALL_ROOT/versions/$previous_version" "$INSTALL_ROOT/current"
  else
    log "the new version failed its post-install check; removing the incomplete install"
    rm -f "$INSTALL_ROOT/current"
  fi
  die "install of $tag did not pass its post-install check"
fi

mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_ROOT/current/bbb" "$BIN_DIR/bbb"

if [ -n "$previous_version" ] && [ "$previous_version" != "$version" ]; then
  log "upgraded bbb: $previous_version -> $version"
elif [ -n "$previous_version" ]; then
  log "reinstalled bbb $version"
else
  log "installed bbb $version"
fi
log "  binary:  $BIN_DIR/bbb"
log "  version: $version_dir"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    log ""
    log "note: $BIN_DIR is not on your PATH. Add this to your shell profile:"
    log "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

if [ "$SKIP_SETUP" -eq 1 ]; then
  log ""
  log "Skipping setup (--skip-setup). Run \"$BIN_DIR/bbb\" setup when ready."
  exit 0
fi

log ""

# `bbb setup` is a conversation: it reads answers from standard input. Under
# `curl … | bash` standard input is the pipe curl wrote this script into, which
# bash has already read to the end, so setup would be handed an immediate EOF
# and die with "setup needs answers, and standard input ended" the moment it
# asked its first question. Reconnect it to the terminal instead — and when
# there is no terminal at all (CI, a container, a `bash < install.sh`), say so
# and stop rather than starting a conversation nobody can answer. The install
# itself is finished and correct either way.
if [ -t 0 ]; then
  exec "$BIN_DIR/bbb" setup
elif (exec 3</dev/tty) 2>/dev/null; then
  # An open, not a `test -r`: in a container /dev/tty exists and looks readable
  # right up until opening it fails with ENXIO because no terminal is attached.
  exec "$BIN_DIR/bbb" setup </dev/tty
else
  log "No terminal is attached, so setup — which asks questions — was not started."
  log "Run \"$BIN_DIR/bbb\" setup from a terminal to finish."
  exit 0
fi
