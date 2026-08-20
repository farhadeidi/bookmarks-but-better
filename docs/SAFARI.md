# Safari

Safari is a supported target and is **daemon-only**. Its WebExtensions
implementation has no bookmarks API, so there is no Browser Source to enable
and connecting a daemon is the only way into the dashboard. This is not a
Safari-shaped special case in feature code: it falls out of the Platform
Capabilities seam (`src/sources/platform.ts`) and
[ADR 0004](adr/0004-expose-browser-differences-as-capabilities-and-ship-safari-daemon-only.md).

Minimum: **macOS 14 (Sonoma) and Safari 17**. Extensions could not `fetch`
cross-origin before Safari 16.4, and `optional_host_permissions` arrived in the
same release; 17/14 is the first pairing worth supporting.

## Capability matrix

| Capability                        | Safari | Chrome / Firefox | Where it is decided                        |
| --------------------------------- | ------ | ---------------- | ------------------------------------------ |
| Browser Source (`chrome.bookmarks`) | no     | yes              | `platformCapabilities().browserSource`     |
| Daemon Sources                    | yes    | yes              | `platformCapabilities().daemonSource`      |
| Omnibox keyword (`bb`)            | no     | yes              | `platformCapabilities().omnibox`           |
| New-tab override                  | no     | yes              | manifest — Safari supports no override     |
| Action popup                      | yes    | yes              | `manifests/manifest.safari.json`           |
| Optional loopback host permission | yes    | yes              | `optional_host_permissions`, asked on Connect |
| Native messaging                  | yes    | n/a              | unused; the appex handler is the converter's stub |

Two consequences the UI has to carry, both driven by capability rather than by
browser name:

- The dashboard is reached from the **popup's "Open the dashboard"** button,
  because there is no new-tab page to override.
- Onboarding **skips the source question** (there is only one answer) and puts
  the **daemon-setup step on the track**, with copy saying the browser's own
  bookmarks are never read and suggesting a vault in iCloud Drive.

`src/extension/build-contract.test.ts` pins all of this to the shipped
manifest, so a capability cannot be re-added by accident.

## Architecture

```
src/ ──(bun run build:safari)──▶ dist-safari/          the extension bundle
dist-safari/ ──(safari/sync-resources.sh)──▶ safari/Bookmarks But Better/
                                              Bookmarks But Better Extension/Resources/
                     ──(safari/build.sh, xcodebuild)──▶ safari/build/Products/Release/
                                              Bookmarks But Better.app
                                                └── Contents/PlugIns/
                                                     Bookmarks But Better Extension.appex
```

A Safari web extension ships inside a macOS app: the `.app` exists only to
carry the `.appex`, and Safari finds the extension by scanning installed apps.
The app window itself does nothing but tell you whether the extension is on and
open Safari's Extensions settings.

Bundle identifiers matter and are not free-form — Safari requires the
extension's id to be a prefixed child of the app's:

| Target    | Bundle identifier                                    |
| --------- | ---------------------------------------------------- |
| App       | `com.farhadeidi.bookmarks-but-better.safari`           |
| Extension | `com.farhadeidi.bookmarks-but-better.safari.Extension` |

The product version is **not** stored in the Xcode project. `safari/build.sh`
reads it from the manifest it just built and passes it as `MARKETING_VERSION`,
so the one version in `package.json` / `Cargo.toml` / the manifests stays the
only version. (A build started from Xcode's UI instead will be stamped `1.0`;
use `build.sh` for anything you intend to keep.)

## Dev loop

```bash
bash safari/build.sh          # build the bundle, sync it, build + ad-hoc sign the app
```

That is the whole loop from a clean checkout — no Apple Developer account, no
credentials, no Xcode UI. It runs `bun run build:safari`, mirrors the result in
with `safari/sync-resources.sh`, checks the two converter corrections below are
still in place, then builds the Release configuration with ad-hoc signing and
verifies the app really carries the extension.

After a rebuild, Safari picks up the new bundle when the app is relaunched. If
Safari is showing a stale version, quit Safari and reopen it.

`safari/sync-resources.sh` can be run on its own after `bun run build:safari`
when you only changed frontend code. It refuses to sync a top-level file the
Xcode project does not reference: `assets/` and `icons/` are folder references
(so Vite's hashed filenames need no project edit), but every other top-level
file is referenced by name and a new one would be copied in and then silently
left out of the built `.appex`.

## What is committed

Committed: the Xcode project, the app's Swift sources, `Info.plist`s, the asset
catalog and the app window's `Resources/` (`Main.html`, `Script.js`,
`Style.css`), plus the two scripts.

Not committed, and ignored in `.gitignore`:

- `safari/build/` — build products.
- `safari/Bookmarks But Better/Bookmarks But Better Extension/Resources/` — the
  extension payload. It is `dist-safari/` mirrored into the place Xcode copies
  from, and `dist-safari/` is itself a build product.
- `xcuserdata/`, `*.xcuserstate` — per-user Xcode state.

## Regenerating the Xcode project

The project was generated once, for real, and committed. To regenerate it
(after a manifest change large enough to matter, or a new Xcode):

```bash
bun run build:safari
rm -rf safari/Bookmarks\ But\ Better
xcrun safari-web-extension-converter dist-safari \
  --project-location safari \
  --app-name "Bookmarks But Better" \
  --bundle-identifier com.farhadeidi.bookmarks-but-better.safari \
  --macos-only --swift --copy-resources --no-open --no-prompt --force
```

Then **reapply both corrections** in
`safari/Bookmarks But Better/Bookmarks But Better.xcodeproj/project.pbxproj`.
`safari/build.sh` checks for both and refuses to build without them, so a
forgotten one fails loudly rather than shipping.

1. **The app target's bundle identifier.** The converter derives it from the
   *app name* (`com.farhadeidi.bookmarks-but-better.Bookmarks-But-Better`),
   which breaks the required `<app-id>.Extension` relationship — the extension
   target is given `…safari.Extension`, a child of an id nothing has. Set both
   `PRODUCT_BUNDLE_IDENTIFIER` entries of the **app** target (Debug and
   Release) to `com.farhadeidi.bookmarks-but-better.safari`.

2. **The deployment target.** The converter pins `MACOSX_DEPLOYMENT_TARGET` to
   the installed SDK's version at the project level (`26.5` on Xcode 26.6),
   which would refuse to run on every Mac older than the build machine, and
   leaves the extension target on `10.14`. Set **every**
   `MACOSX_DEPLOYMENT_TARGET` to `14.0` — macOS 14 is the Safari 17 minimum.

```bash
sed -i '' \
  -e 's/PRODUCT_BUNDLE_IDENTIFIER = "com\.farhadeidi\.bookmarks-but-better\.Bookmarks-But-Better";/PRODUCT_BUNDLE_IDENTIFIER = "com.farhadeidi.bookmarks-but-better.safari";/' \
  -e 's/MACOSX_DEPLOYMENT_TARGET = [0-9.]*;/MACOSX_DEPLOYMENT_TARGET = 14.0;/' \
  "safari/Bookmarks But Better/Bookmarks But Better.xcodeproj/project.pbxproj"
```

The converter also warns that `background.type` is not supported by Safari.
That is expected and harmless: the background script is built as an IIFE
(`src/extension/build-contract.ts`), so Safari loading it as a classic script
is exactly right.

## Signing and distribution

`safari/build.sh` signs **ad hoc** (`CODE_SIGN_IDENTITY=-`). That is enough to
run the app and enable the extension on the machine that built it, with
unsigned extensions allowed in Safari's Develop menu — and it needs no Apple
Developer Program membership.

Anything beyond that machine does need one:

- **Developer ID** signing plus notarization for a downloadable `.app`.
- **App Store / TestFlight** for the Mac App Store, which is where Safari
  extensions are normally distributed.

Neither is wired up here, because the membership is not held yet. Two things to
know before that changes:

- The app is a shell around the extension, and out of the box the extension is
  useless without a separately installed daemon. That is an **App Review
  guideline 2.1** risk worth a considered submission note rather than a
  surprise.
- The daemon cannot be sandboxed inside the app; it stays a separate local
  install, exactly as on Chrome and Firefox.

## Automated coverage

- `bun run test` — the capability seam, the manifest contract, and the
  Safari-shaped onboarding (jsdom, with capabilities set to Safari's).
- `bun run test:ui` — `?scenario=safari` in the Dev Workbench: one source, no
  tab switcher, daemon-only empty state.
- `bun run test:e2e:safari` (`tests/e2e/run-safari.sh`) — the real built bundle
  served by a throwaway daemon on an isolated port, proving the shipped
  manifest claims no capability Safari lacks, that the page has no bookmarks
  API, that connecting a Vault makes it the only source, and that a change made
  by another client of the daemon arrives live over the change stream.

None of that runs in Safari — Chromium drives it. Everything Safari-specific is
the checklist below.

## Manual QA checklist

Do these in order on macOS 14 or later, with Safari 17 or later. Anything that
fails is a bug worth filing before the build is called good.

1. **Build.** From a clean checkout, run `bun install`, then
   `bash safari/build.sh`. It must end with `** BUILD SUCCEEDED **` and print
   the app path, the version, and the two bundle ids
   (`com.farhadeidi.bookmarks-but-better.safari` and the same with
   `.Extension`).
2. **Register the app.** Open the built app once:
   `open "safari/build/Products/Release/Bookmarks But Better.app"`. A small
   window appears saying whether the extension is on. Leave it open for now.
3. **Allow unsigned extensions.** In Safari: **Settings → Advanced →** tick
   **"Show features for web developers"**. Then in the menu bar: **Develop →
   Allow Unsigned Extensions**, and authenticate. This resets every time Safari
   quits — if the extension disappears later, this is why.
4. **Enable the extension.** Safari **Settings → Extensions**. "Bookmarks But
   Better Extension" is listed; tick it. Its detail pane should show the
   version you built and request no website access at this point.
5. **The popup exists.** The toolbar shows the extension's icon (if not:
   **View → Customize Toolbar**, drag it in). Click it. The popup opens on
   "Save this page", with the destination line reading "Preparing bookmark
   source…" or an error — there is no source yet, which is correct.
6. **No new-tab override.** Open a new tab (⌘T). It must be Safari's own start
   page, unchanged: Safari supports no new-tab override and the manifest asks
   for none. The dashboard is reached in the next step instead.
7. **Open the dashboard.** In the popup, click **"Open the dashboard"**. A new
   tab opens on the extension's dashboard, showing **"No bookmark source yet."**
   and a **"Connect a daemon"** button — Safari's own bookmarks are not read,
   and nothing pretends otherwise.
8. **Onboarding shape.** On a fresh profile the setup wizard runs first. Check
   it never asks "Where do your bookmarks live?" and that its daemon step says
   the browser does not share its own bookmarks and mentions iCloud Drive.
9. **Start a daemon.** In a terminal:
   `bookmarks-but-better setup` (or `init --vault <path>`) and then
   `bookmarks-but-better serve --vault <path>` — see
   [docs/DAEMON.md](DAEMON.md). Note the port it prints (52222 by default).
10. **The loopback permission prompt.** In the dashboard, click **"Connect a
    daemon"** → **Sources**, leave the address as `http://127.0.0.1:52222` (or
    correct the port), and click **Connect**. Safari must show a permission
    prompt for `127.0.0.1` — allow it. This prompt appearing *at Connect*, and
    not at install, is the point: the extension asks for nothing until you
    connect.
11. **The Vault is the source.** After allowing, the Vault appears as the only
    source (a name-and-health badge, not a tab switcher) and its bookmarks
    render. Denying the prompt instead must produce a clear error, never a
    silent fallback to another source.
12. **Capture flow.** Navigate to any page, click the extension icon, and
    click **Save bookmark**. The popup names the destination Vault, reports
    "Bookmark saved", and the bookmark appears in the dashboard tab without a
    reload — and as a Markdown file in the vault directory on disk.
13. **External change.** Edit the vault from outside the browser (add a
    bookmark with `curl` against the daemon's API, or edit the Markdown files
    directly). The open dashboard tab must update live.
14. **Restart.** Quit and reopen Safari. Re-enable **Allow Unsigned
    Extensions** if prompted; the connection and the Vault must still be there,
    and the dashboard must load without asking for the permission again.
15. **Forget.** In **Settings → Sources**, click **Forget daemon**. The dashboard
    returns to "No bookmark source yet." and the loopback permission is
    released.
