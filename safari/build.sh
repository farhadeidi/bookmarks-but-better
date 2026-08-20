#!/usr/bin/env bash
# One command from a clean checkout to an ad-hoc signed Safari app.
#
#   bash safari/build.sh
#
# No Apple Developer account, no credentials, no Xcode GUI: the app is signed
# ad hoc ("-"), which is all macOS asks of an extension you enable yourself in
# Safari's Extensions settings. Distribution outside this machine is a
# different, account-bound story — see docs/SAFARI.md.
#
# The result is a macOS app whose only job is to carry the extension:
#   safari/build/Products/Release/Bookmarks But Better.app
#     └── Contents/PlugIns/Bookmarks But Better Extension.appex
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
project_dir="$repo_root/safari/Bookmarks But Better"
project="$project_dir/Bookmarks But Better.xcodeproj"
pbxproj="$project/project.pbxproj"
build_dir="$repo_root/safari/build"
app_bundle_id="com.farhadeidi.bookmarks-but-better.safari"

# The two corrections `safari-web-extension-converter` needs after every
# generation (docs/SAFARI.md → Regenerating the Xcode project). They are
# checked rather than trusted, because a regeneration silently reintroduces
# both and the damage is only visible when Safari refuses to show the
# extension or the app refuses to launch on a supported macOS.
require_correction() {
  local pattern=$1 description=$2
  if ! grep -q "$pattern" "$pbxproj"; then
    echo "safari/build.sh: the Xcode project is missing a required correction:" >&2
    echo "  $description" >&2
    echo "See docs/SAFARI.md → Regenerating the Xcode project." >&2
    exit 1
  fi
}

require_correction \
  "PRODUCT_BUNDLE_IDENTIFIER = \"${app_bundle_id}\";" \
  "the app target's bundle id must be ${app_bundle_id}, so that the extension's ${app_bundle_id}.Extension is a prefixed child of it"
require_correction \
  "MACOSX_DEPLOYMENT_TARGET = 14.0;" \
  "the deployment target must be macOS 14.0 (Safari 17), not the SDK version the converter pins"
if grep -q "MACOSX_DEPLOYMENT_TARGET = \(1[5-9]\|[2-9][0-9]\)" "$pbxproj"; then
  echo "safari/build.sh: a MACOSX_DEPLOYMENT_TARGET above 14.0 is set." >&2
  echo "See docs/SAFARI.md → Regenerating the Xcode project." >&2
  exit 1
fi

cd "$repo_root"
bun run build:safari
bash safari/sync-resources.sh

# The one product version, taken from the manifest that was just built rather
# than kept a second time in the Xcode project (where it would drift).
version=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' dist-safari/manifest.json | head -1)
if [[ -z "$version" ]]; then
  echo "safari/build.sh: could not read the version from dist-safari/manifest.json" >&2
  exit 1
fi

# `-target` rather than `-scheme`: the converter writes no shared scheme, and
# adding one by hand would be a third thing to reapply after every
# regeneration. Targets are in the project file, so this works on a fresh
# clone whatever the local Xcode's scheme-autocreation setting is. SYMROOT and
# OBJROOT keep every artifact under safari/build/ instead of the shared
# DerivedData directory.
xcodebuild \
  -project "$project" \
  -target "Bookmarks But Better" \
  -configuration Release \
  SYMROOT="$build_dir/Products" \
  OBJROOT="$build_dir/Intermediates" \
  MARKETING_VERSION="$version" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY=- \
  DEVELOPMENT_TEAM= \
  build

app="$build_dir/Products/Release/Bookmarks But Better.app"
appex="$app/Contents/PlugIns/Bookmarks But Better Extension.appex"

# What the build has to have produced for Safari to be able to load it at all.
[[ -d "$app" ]] || { echo "safari/build.sh: no app at $app" >&2; exit 1; }
[[ -d "$appex" ]] || { echo "safari/build.sh: no extension at $appex" >&2; exit 1; }
[[ -f "$appex/Contents/Resources/manifest.json" ]] || {
  echo "safari/build.sh: the extension carries no manifest.json" >&2
  exit 1
}
codesign --verify --deep --strict "$app"

echo
echo "Built and ad-hoc signed:"
echo "  $app"
echo "Version: $version"
echo "App bundle id:       $(defaults read "$app/Contents/Info" CFBundleIdentifier)"
echo "Extension bundle id: $(defaults read "$appex/Contents/Info" CFBundleIdentifier)"
echo
echo "Next: open the app once, then enable the extension in"
echo "Safari → Settings → Extensions (docs/SAFARI.md → Manual QA checklist)."
