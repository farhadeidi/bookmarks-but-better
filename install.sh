#!/usr/bin/env bash
# Installs (or upgrades) the `bookmarks-but-better` daemon for the current user
# — no sudo, no system-wide anything — then runs `bookmarks-but-better setup`.
#
# Usage — `bash`, not `sh`: `set -o pipefail` below is a bash builtin option,
# and /bin/sh is dash on Debian and Ubuntu, where piping this into `sh` dies on
# that line with "set: Illegal option -o pipefail" before it can say why.
#
#   curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --beta
#   curl -fsSL .../install.sh | bash -s -- --version v4.0.0
#
# Every release is a GitHub Release built by .github/workflows/release.yml,
# which uploads one archive and one .sha256 checksum per platform, plus this
# script itself under a fixed name (see that file for exactly what is in each
# archive). This script:
#
#   1. Resolves which release to install: the latest *stable* release by
#      default, or the latest (or a named) prerelease with --beta /
#      --version. A stable release that carries no daemon build for this
#      platform — every stable release up to and including v3.2.0 was
#      extension-only — falls back to the latest prerelease that does have
#      one, and says so.
#   2. Downloads that platform's archive and its .sha256 sidecar from the
#      GitHub Release, and refuses to install unless the archive's hash
#      matches it.
#   3. Unpacks into a versioned directory under
#      $BOOKMARKS_BUT_BETTER_INSTALL_ROOT and only then repoints a `current`
#      symlink at it — so a failed download or a binary that won't even run
#      leaves whatever was already installed completely untouched, and an
#      install that got this far can always be rolled back to the version the
#      symlink pointed at before.
#   4. Symlinks `bookmarks-but-better` on $BOOKMARKS_BUT_BETTER_BIN_DIR, and
#      finally runs `bookmarks-but-better setup`.
#
# Everything it fetches is a GitHub Release URL — the release download endpoint
# and the releases Atom feed — so there is no dependency on the GitHub JSON API
# and none on `jq`. curl, tar and a SHA-256 tool are the whole toolchain.
#
# Nothing here touches a vault. Uninstalling is: remove
# $BOOKMARKS_BUT_BETTER_INSTALL_ROOT and
# $BOOKMARKS_BUT_BETTER_BIN_DIR/bookmarks-but-better; your vault, wherever you
# pointed `bookmarks-but-better setup` at, is a directory of Markdown files
# this script has never heard of.
set -euo pipefail

REPO="farhadeidi/bookmarks-but-better"
EXE="bookmarks-but-better"
# Overridable only for this script's own test suite — there is no supported
# reason to point it anywhere but github.com in normal use.
GITHUB_BASE="${BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE:-https://github.com}"
RELEASES_BASE="$GITHUB_BASE/$REPO/releases"
INSTALL_ROOT="${BOOKMARKS_BUT_BETTER_INSTALL_ROOT:-$HOME/.local/share/bookmarks-but-better}"
BIN_DIR="${BOOKMARKS_BUT_BETTER_BIN_DIR:-$HOME/.local/bin}"
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
  --install-dir <dir>   Where versions are unpacked. Default:
                        ~/.local/share/bookmarks-but-better (or
                        $BOOKMARKS_BUT_BETTER_INSTALL_ROOT).
  --bin-dir <dir>       Where the `bookmarks-but-better` symlink is created.
                        Default: ~/.local/bin (or
                        $BOOKMARKS_BUT_BETTER_BIN_DIR).
  --skip-setup          Install the binary but do not run
                        `bookmarks-but-better setup` afterward.
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
#
#    Resolution reads two GitHub Release endpoints and nothing else:
#
#      /releases/latest        redirects to /releases/tag/<latest stable tag>
#      /releases.atom          the newest releases, newest first
#
#    A release tag here is either vX.Y.Z or vX.Y.Z-beta.N — release.yml accepts
#    no other shape — so "is this a prerelease" is a property of the tag and
#    needs no API lookup to answer.
# ---------------------------------------------------------------------------

# The archive this platform needs from a given release. Every release names it
# after its own version, so this can only be computed per release — which is
# exactly why the fallback below has to probe each candidate rather than just
# taking the newest thing it finds.
archive_name_for() {
  printf '%s-%s-%s.tar.gz' "$EXE" "${1#v}" "$TARGET"
}

asset_url_for() {
  printf '%s/download/%s/%s' "$RELEASES_BASE" "$1" "$2"
}

# True when a release actually ships a daemon build for this platform. An
# extension-only release (every stable release up to and including v3.2.0) does
# not, and installing from one is not a thing that can succeed.
release_has_daemon() {
  local tag="$1"
  curl -fsSL --head -o /dev/null "$(asset_url_for "$tag" "$(archive_name_for "$tag")")" 2>/dev/null
}

is_prerelease_tag() {
  case "$1" in
    *-beta.*) return 0 ;;
    *) return 1 ;;
  esac
}

# The tag /releases/latest redirects to — GitHub's "latest" is by definition
# the newest non-draft, non-prerelease release, so this needs no filtering.
latest_stable_tag() {
  local final
  final=$(curl -fsSL --head -o /dev/null -w '%{url_effective}' "$RELEASES_BASE/latest") || return 1
  final="${final%/}"
  printf '%s' "${final##*/}"
}

# Every release tag in the Atom feed, newest first. The feed's entry links are
# .../releases/tag/<tag>, which is the only thing read out of it.
release_tags() {
  curl -fsSL "$RELEASES_BASE.atom" \
    | tr '<' '\n' \
    | sed -n 's|.*/releases/tag/\([^"]*\)".*|\1|p'
}

# The newest prerelease that actually has a build for this platform.
latest_beta_tag_with_daemon() {
  local candidate
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    is_prerelease_tag "$candidate" || continue
    if release_has_daemon "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done <<EOF
$(release_tags)
EOF
  return 1
}

if [ -n "$EXPLICIT_VERSION" ]; then
  tag="${EXPLICIT_VERSION#v}"
  tag="v${tag}"
  log "resolving explicit release $tag"
elif [ "$CHANNEL" = "beta" ]; then
  log "resolving the latest prerelease"
  tag=$(latest_beta_tag_with_daemon) \
    || die "no prerelease has a $EXE build for $TARGET; pass --version to install a specific one"
else
  log "resolving the latest stable release"
  tag=$(latest_stable_tag) || die "could not resolve the latest release"
  [ -n "$tag" ] || die "could not resolve the latest release"

  # A stable release that carries no daemon build is how `curl … | bash` ends
  # in "release vX has no asset named bookmarks-but-better-…" — every stable
  # release up to and including v3.2.0 was extension-only. Fall back to the
  # newest prerelease that does carry a build for this platform, loudly: a
  # prerelease is normally something you have to ask for, and this is the one
  # case where the alternative is not installing at all.
  if ! release_has_daemon "$tag"; then
    log "the latest stable release ($tag) ships no $EXE daemon build for $TARGET"
    log "falling back to the latest prerelease — pass --version <tag> to pin a specific release"
    tag=$(latest_beta_tag_with_daemon) \
      || die "no stable or prerelease release has a $EXE build for $TARGET yet"
  fi
fi

version="${tag#v}"
[ "$version" != "$tag" ] || die "the resolved release tag '$tag' is not a vMAJOR.MINOR.PATCH tag"
log "installing $tag (version $version)"

archive_name=$(archive_name_for "$tag")
archive_url=$(asset_url_for "$tag" "$archive_name")
checksum_url=$(asset_url_for "$tag" "$archive_name.sha256")

# ---------------------------------------------------------------------------
# 3. Download and verify. Nothing below this point is installed until the
#    hash matches.
# ---------------------------------------------------------------------------
work_dir=$(mktemp -d)
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT

log "downloading $archive_name"
curl -fsSL -o "$work_dir/$archive_name" "$archive_url" \
  || die "release $tag has no asset named $archive_name"
curl -fsSL -o "$work_dir/$archive_name.sha256" "$checksum_url" \
  || die "release $tag has no checksum for $archive_name"

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

staged="$extract_dir/$EXE-$version-$TARGET"
[ -x "$staged/$EXE" ] || die "the archive did not contain an executable $EXE — this is a packaging bug, not a local problem"

"$staged/$EXE" --version >/dev/null 2>&1 \
  || die "the downloaded $EXE binary does not run on this machine (checked with --version)"

previous_version=""
if [ -L "$INSTALL_ROOT/current" ]; then
  previous_version=$(basename "$(readlink "$INSTALL_ROOT/current")")
fi

version_dir="$INSTALL_ROOT/versions/$version"
rm -rf "$version_dir"
mkdir -p "$(dirname "$version_dir")"
mv "$staged" "$version_dir"

# ---------------------------------------------------------------------------
# 5. Repoint `current` — the one step that changes what a running
#    `bookmarks-but-better` on $PATH resolves to. `-n` (`--no-dereference`,
#    supported by both GNU and BSD `ln`) replaces the symlink itself rather
#    than, since it already points at a directory, being interpreted as "put
#    this inside that directory".
# ---------------------------------------------------------------------------
ln -sfn "$version_dir" "$INSTALL_ROOT/current"

if ! "$INSTALL_ROOT/current/$EXE" --version >/dev/null 2>&1; then
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
ln -sf "$INSTALL_ROOT/current/$EXE" "$BIN_DIR/$EXE"

if [ -n "$previous_version" ] && [ "$previous_version" != "$version" ]; then
  log "upgraded $EXE: $previous_version -> $version"
elif [ -n "$previous_version" ]; then
  log "reinstalled $EXE $version"
else
  log "installed $EXE $version"
fi
log "  binary:  $BIN_DIR/$EXE"
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
  log "Skipping setup (--skip-setup). Run \"$BIN_DIR/$EXE\" setup when ready."
  exit 0
fi

log ""

# `bookmarks-but-better setup` is a conversation: it reads answers from
# standard input. Under `curl … | bash` standard input is the pipe curl wrote
# this script into, which bash has already read to the end, so setup would be
# handed an immediate EOF and die with "setup needs answers, and standard input
# ended" the moment it asked its first question. Reconnect it to the terminal
# instead — and when there is no terminal at all (CI, a container, a
# `bash < install.sh`), say so and stop rather than starting a conversation
# nobody can answer. The install itself is finished and correct either way.
if [ -t 0 ]; then
  exec "$BIN_DIR/$EXE" setup
elif (exec 3</dev/tty) 2>/dev/null; then
  # An open, not a `test -r`: in a container /dev/tty exists and looks readable
  # right up until opening it fails with ENXIO because no terminal is attached.
  exec "$BIN_DIR/$EXE" setup </dev/tty
else
  log "No terminal is attached, so setup — which asks questions — was not started."
  log "Run \"$BIN_DIR/$EXE\" setup from a terminal to finish."
  exit 0
fi
