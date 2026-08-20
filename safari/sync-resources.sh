#!/usr/bin/env bash
# Mirrors the built Safari extension bundle into the Xcode project.
#
# `dist-safari/` is the product of `bun run build:safari` and is not committed;
# the Xcode project's `Bookmarks But Better Extension/Resources` directory is
# that build product in the place Xcode copies it from. This script is the only
# thing that writes there, so the two can never drift by hand.
#
# The Xcode project references `assets/` and `icons/` as *folder* references, so
# Vite's content-hashed filenames flow through without touching the project
# file. Every other top-level entry is referenced individually and by name,
# which is why this script refuses to sync a top-level entry the project does
# not reference: it would be copied here and then silently left out of the
# built `.appex`.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
dist="$repo_root/dist-safari"
project_dir="$repo_root/safari/Bookmarks But Better"
resources="$project_dir/Bookmarks But Better Extension/Resources"
pbxproj="$project_dir/Bookmarks But Better.xcodeproj/project.pbxproj"

if [[ ! -d "$dist" ]]; then
  echo "safari/sync-resources.sh: $dist does not exist." >&2
  echo "Run 'bun run build:safari' first (safari/build.sh does)." >&2
  exit 1
fi

# Fail before copying anything: a file that is not in the project file would
# reach the Resources directory and then not reach the extension bundle.
missing=()
for entry in "$dist"/*; do
  name=$(basename "$entry")
  # Xcode quotes a path only when it has to, so both spellings are valid.
  if ! grep -qF "path = Resources/${name};" "$pbxproj" &&
    ! grep -qF "path = \"Resources/${name}\";" "$pbxproj"; then
    missing+=("$name")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "safari/sync-resources.sh: the Xcode project does not reference:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "Add them to the 'Bookmarks But Better Extension' target's Resources" >&2
  echo "build phase in Xcode, or regenerate the project (see docs/SAFARI.md)." >&2
  exit 1
fi

mkdir -p "$resources"
rsync --archive --delete "$dist"/ "$resources"/
echo "Synced $dist -> $resources"
