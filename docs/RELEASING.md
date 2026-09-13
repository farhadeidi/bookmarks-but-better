# Releasing

One product version covers the app, all three extension manifests and the Cargo
workspace, and a tag is what turns that version into a release. The npm Daemon
Manager has a version of its own and names the daemon release it installs in
its `package.json`; it is published whenever it changes, and always after the
GitHub release it names exists.

Two commands do the whole job:

```sh
git push origin v4.1.0-beta.1   # a prerelease: artifacts to download, no store
git push origin v4.1.0          # the real thing: stores, after an approval
```

No product artifact is published another way. Merging to `main` runs
[`ci.yml`](../.github/workflows/ci.yml) and stops there. The npm Daemon Manager
is the one manual publishing step, documented below.

## What each tag does

| You push        | You get                                                                                     | Stores                                       |
| --------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `v4.1.0-beta.N` | A GitHub **prerelease** with three extension zips, five daemon archives and both installers | **Never contacted.** The job does not exist. |
| `v4.1.0`        | A normal GitHub **Release** with the same artifacts                                         | After a maintainer approves the deployment.  |

Both run the identical build and the identical test suite — the release workflow
calls `ci.yml` rather than keeping a second copy of the gates that could drift
from it. A beta is a real build; the only thing it does not do is publish.

## Cutting a beta

1. Reconcile the product version everywhere. For `4.1.0` that means `4.1.0` —
   exactly this string — in these eight places:
   - `package.json`
   - `packages/bookmarks-but-better/package.json` — the `daemon.version` field,
     not the package's own `version`
   - `manifests/manifest.chrome.json`
   - `manifests/manifest.firefox.json`
   - `manifests/manifest.safari.json`
   - `Cargo.toml` (`[workspace.package] version`)
   - `crates/bookmarks-but-better/Cargo.toml` (the
     `bookmarks-but-better-vault-core` constraint, twice)
   - `Cargo.lock` — run `cargo update --workspace` after the two above

2. Add a `## [4.1.0]` section to `CHANGELOG.md`.

3. Tag and push:

   ```sh
   git tag v4.1.0-beta.1
   git push origin v4.1.0-beta.1
   ```

The `validate` job checks every one of those before anything is built, and fails
with the file and both values when one disagrees. Getting it wrong costs a minute,
not a bad release.

### Betas keep the plain version, on purpose

A beta tag is `v4.1.0-beta.1`, but every manifest inside it still reads `4.1.0`.
That is not an oversight and must not be "fixed":

- Chrome accepts one to four dot-separated integers as a version and nothing
  else. `4.1.0-beta.1` is not a valid extension version.
- AMO rejects it too.

So the beta-ness lives in the tag and in the GitHub prerelease, never in a
manifest. The artifact _filenames_ carry the full tag (`…-chrome-4.1.0-beta.1.zip`)
so a downloaded build is still identifiable, and the release notes say so. The
`validate` job enforces both halves: manifests must equal the base version, and
must be numeric.

Iterating means `-beta.2`, `-beta.3`, and so on. All of them build `4.1.0`
manifests. That is fine, because no store ever sees them.

## Cutting the stable release

Before creating the stable tag:

1. Install the unpacked Chrome and Firefox builds over profiles that have
   completed setup on v3.2.1. Confirm the dashboard opens directly, the selected
   root and appearance are unchanged, and the setup wizard is not shown.
2. In a fresh profile, complete setup once with the Browser Source and once with
   a Daemon Source. Restart the extension and confirm setup stays closed. Then
   switch sources and repeat.
3. Review `marketing/store-description.chrome.txt` and
   `marketing/store-description.firefox.txt` against the final manifests,
   especially permission and privacy disclosures. These files are the listing
   text for both stores: the release sets the Firefox description from its file,
   and tells you when the Chrome one needs pasting — see
   [Store listings](#store-listings).
4. Confirm the store screenshots and promotional assets show the current v4 UI.
5. Run `bun run check` and confirm the latest CI run is green on Linux, macOS
   and Windows.

```sh
git tag v4.1.0
git push origin v4.1.0
```

The build, the tests, the GitHub Release and its artifacts all happen without
anyone doing anything. Then the run **stops and waits**: `publish-stores` is
attached to the `production-stores` environment, and GitHub will not start it
until a required reviewer approves the deployment from the run page.

That pause depends entirely on the environment having **required reviewers**. It
does, and the job refuses to run at all unless the environment is configured —
see [One-time repository setup](#one-time-repository-setup). The pause is
enforced by the environment attached to the job, so it holds regardless of
whether the store credentials are repository- or environment-scoped.

Approve it and the two submissions run. Decline it and you have a finished
GitHub Release with no store submission — a perfectly good place to stop.

All of this depends on the run succeeding on its **first** attempt. If anything
upstream fails — a test, one leg of the daemon matrix, a cross-compile — then
re-running the tag push will neither create the GitHub release nor submit to a
store, even though nothing was ever published. Both are limited to attempt 1, so
that a re-run can never overwrite a release or re-submit a version.

That is not a fault to work around; it is the rule, and
[Recovery](#recovery-re-running-a-store-submission) is how you finish the
release. The re-run's job summary tells you which situation you are in and what
to do about it.

## What "published" means for Firefox

The AMO step going green means **uploaded and validated**, not **live**.

A listed version only goes live once a Mozilla reviewer approves it, which can
take days. The workflow does not wait for that — it passes `approvalTimeout: 0`,
which tells the action to return as soon as upload and validation succeed. That
is what makes a green step trustworthy rather than merely optimistic: a genuine
failure (expired credentials, a duplicate version, a validation error) now fails
the job, where the old blanket `continue-on-error: true` hid all three.

The job summary says this on every run, and links the dashboard. Check it:
<https://addons.mozilla.org/developers/>

> AMO also requires a source-code upload to review a bundled build. The first
> listed submission may need a one-time manual source upload from the dashboard.

## Store listings

The listing descriptions live in the repository, one file per store. Edit the
files, not the dashboards: a stable release writes the Firefox file over
whatever the AMO dashboard holds.

| Store            | Description                                                            | Summary, name, screenshots, promo images |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| Firefox AMO      | Set from `marketing/store-description.firefox.txt` by `publish-stores` | Edited in the dashboard                  |
| Chrome Web Store | Pasted by hand from `marketing/store-description.chrome.txt`           | Edited in the dashboard                  |

**Firefox.** Once AMO accepts the version, `publish-stores` replaces the
description in the add-on's default locale with the file from the tag. Other
locales are left as they are. The listing is add-on wide and changes at once,
while the version waits for review, so for that window the text can describe a
version that is not live yet.

If the update fails, the job stays green and its summary says so. The version is
already submitted, so **do not** start a recovery dispatch for it — AMO would
reject the version as a duplicate. Paste the file into the listing at
<https://addons.mozilla.org/developers/> instead.

**Chrome.** The Chrome Web Store API uploads and publishes packages and has no
endpoint for listing text, so this stays a manual step. When Chrome publishes,
the job summary compares the file with the previous stable tag. If it changed,
the summary links the diff and includes the text ready to paste into the
**Store listing** tab at <https://chrome.google.com/webstore/devconsole>. Only a
change since the previous stable tag is flagged; one that was never pasted for
an earlier release is not flagged again.

## Recovery: re-running a store submission

> **"Re-run failed jobs" is not the recovery mechanism — for any run.** It
> publishes nothing, by design. Store submission is limited to the **first
> attempt**, of a tag push _and_ of a manual dispatch alike, and a re-run writes
> a job summary saying so and pointing here.
>
> **That includes re-running a manual recovery that failed.** This is the one
> people get wrong, because the guess is reasonable and wrong: GitHub
> **preserves a dispatch's inputs across a re-run**, so "Re-run failed jobs"
> would come back with the same store still ticked and submit again. The whole
> `publish-stores` job therefore requires the first attempt, so a re-run of a
> dispatch has no job at all — nothing to approve, no credential resolved, no
> store contacted. **A re-run is never a second submission. Start a fresh Run
> workflow.**
>
> **It also holds when the earlier attempt never reached the stores.** A failure
> in the build, the tests, or one leg of the five-way daemon matrix is the
> likelier reason you are reading this, and in that case nothing was ever
> uploaded — but re-running still will not publish.
>
> On a tag push the restriction exists for a second reason too: a re-run cannot
> tell the two situations apart. Without the limit it would re-run _both_ store
> steps with neither toggle consulted; and if the previous attempt _did_ reach a
> store, Chrome goes first, so it would re-upload an already-published version,
> be rejected, and abort before reaching the Firefox step that needed retrying.

> **A re-run does not touch the GitHub release either.** Creating and uploading
> it is limited to the first attempt for the same reason: the release action
> updates in place, so on a re-run it would rewrite the notes and overwrite the
> assets of a release people may already be downloading. A re-run instead writes
> a summary saying what the release currently holds — including a warning if it
> carries fewer assets than the run produced, which means an earlier attempt died
> part-way through uploading.

### First: does the release exist?

This decides which recovery you are doing, and the re-run summary answers it for
you.

**If the release exists**, go straight to the dispatch steps below.

**If it does not** — the first attempt failed before the release job, so nothing
was created and re-running will not create it — pick one:

1. **Delete the tag and push it again.** A clean first attempt does everything.
   Simplest, and correct as long as nothing was published anywhere yet.
2. **Create the release by hand** from the run's artifacts
   (`gh release create v4.1.0 artifacts/*`), then dispatch for the stores.

Do not skip this. A dispatch **refuses to run** unless a published release
already exists for the tag — see [What stops an accidental
publication](#what-stops-an-accidental-publication) — so a dispatch against a
tag with no release fails after you have already approved the deployment.

### Then: dispatch for the stores

Whether a store failed or the run never got that far, the way to publish is the
same — run the workflow manually:

1. **Actions → Release → Run workflow**.
2. Under **Use workflow from**, pick the **tag** (`v4.1.0`), not a branch. A
   dispatch from a branch is refused — the pipeline will not publish something
   that was never tagged.
3. Tick the store or stores you need. **Both default to off**, because a re-run
   to fix Firefox that also re-publishes Chrome is exactly the accident this
   guards against. If the run never reached the stores at all, tick both.
4. Approve the `production-stores` deployment again.

If this dispatch itself fails, **do not re-run it** — a re-run submits nothing.
Go back to step 1 and start another **Run workflow**. Each submission is one
fresh dispatch.

Only the credentials for the stores you tick are checked, so a Firefox-only
recovery is not blocked by a Chrome credential it will never use.

If Chrome **failed** rather than being skipped, check
<https://chrome.google.com/webstore/devconsole> before retrying. A duplicate
rejection and a genuine upload failure look identical in the summary and need
opposite retries: if the version is already listed, Chrome is done — tick only
Firefox, or you will fail again and stall Firefox a second time. If it is not
listed, tick both. The job summary says this too, at the moment you need it.

A dispatch run does not re-create the GitHub Release, which already exists. It
does re-run the full CI suite and all five platform builds before it reaches the
store step, so **expect roughly 20–30 minutes** even though only one zip is being
submitted. That is deliberate: the recovery path builds from the tag rather than
trusting a stored artifact.

One consequence worth knowing: a dispatch run **rebuilds** the extensions from
the tag rather than reusing the files attached to the release. They are the same
bytes only insofar as the build is reproducible. The run says so in its job
summary rather than letting a green checksum imply more than it proves.

## What stops an accidental publication

Four independent conditions, so that no single mistake is enough:

1. **The tag filter.** `on.push.tags` lists the stable and beta shapes
   separately, so an unintended tag shape starts no run at all.
2. **`validate`.** It re-parses the tag with an anchored expression and refuses
   to continue unless every version file agrees with it.
3. **`publish-stores` itself.** The job is conditioned on the version not being a
   prerelease, and its **first** step re-checks the version — before the release
   lookup, before the canary and before either credential guard, so a non-stable
   version is refused before any credential is resolved at all.
4. **The canary.** The job refuses to run unless the `production-stores`
   environment carries `PRODUCTION_STORES_CONFIGURED` — see below for why that is
   necessary, and why it deliberately says nothing about where the six store
   credentials live.

On top of those, the human approval: `publish-stores` names an environment with a
required reviewer, so GitHub holds every step of the job until someone approves
it. That is enforced by the environment on the job, not by the scope of the
secrets, and the six store credentials are repository-scoped on purpose
([step 2](#2-the-six-store-credentials-stay-at-repository-scope)).

Store submission is additionally limited to the **first attempt of a run** — a
tag push _or_ a manual dispatch — and so is creating the GitHub release. A re-run
can neither publish to a store nor overwrite a release that already exists.

A **manual dispatch** carries one more precondition, because its whole premise is
that it is _finishing_ a release rather than starting one. Before any credential
is touched it queries the GitHub API and refuses unless there is a release for
the exact validated tag that is **published, not a draft, and not a prerelease**.
An unanswerable query — an API error rather than a clean "not found" — is also a
refusal: failing closed means never reading an unanswered question as a pass.

Without that check, a dispatch against a tag whose release was never created
would push an extension to a store with nothing behind it in the repository,
leaving the store ahead of the project. Nothing downstream can undo that.

A re-run of a **dispatch** publishes nothing either, and this is the case worth
knowing about because the obvious guess is wrong. GitHub **preserves a
dispatch's inputs across a re-run**, so "Re-run failed jobs" on a manual recovery
would come back with the same store still ticked and submit again. The whole
`publish-stores` job therefore requires the first attempt, whatever started it.

**A re-run is never a second submission.** To submit again, start a fresh **Run
workflow**.

## The daemon archives

Each release carries five, one per supported platform, each with a `.sha256`:

| Target                      | Archive   |
| --------------------------- | --------- |
| `x86_64-unknown-linux-gnu`  | `.tar.gz` |
| `aarch64-unknown-linux-gnu` | `.tar.gz` |
| `x86_64-apple-darwin`       | `.tar.gz` |
| `aarch64-apple-darwin`      | `.tar.gz` |
| `x86_64-pc-windows-msvc`    | `.zip`    |

Each unpacks to:

```
bookmarks-but-better-<version>-<target>/
  bookmarks-but-better[.exe]   the daemon, HTTP API and CLI
  ui/                          the built web UI
  README.md
  LICENSE
```

```sh
./bookmarks-but-better serve --vault <path-to-your-vault> --ui-dir ./ui
```

The daemon does not compile the UI into the binary —
`crates/bookmarks-but-better/src/ui.rs`
serves it from a sandboxed directory handle chosen at run time, which is what
lets the UI be replaced without a rebuild and what keeps the "refuse every
symlink" rule enforceable. The archive is therefore where the UI is bundled, and
`--ui-dir ./ui` is what connects the two. Without it the daemon serves the API
only, which is a supported way to run it.

The Linux `aarch64` build is cross-compiled and, like both macOS targets, is
built rather than tested by the release workflow. That is deliberate: `ci.yml`
already ran the full Rust suite natively on Linux, macOS and Windows before the
release job started.

### The macOS and Windows binaries are unsigned

There is no Apple Developer ID signature or notarization, and no Authenticode
signature. Gatekeeper and SmartScreen will both object, and users will need
`xattr -d com.apple.quarantine ./bookmarks-but-better` on macOS or
_More info → Run anyway_ on Windows. The release notes say so on every release.

Changing that means buying an Apple Developer account and a code-signing
certificate, and adding signing keys to the release pipeline. Until then the
`.sha256` files are what a cautious user has to go on.

## The installers are release assets too

`install.sh` and `install.ps1` are attached to every release under those exact
names, each with a `.sha256` sidecar, by the `installers` job. Fixed names,
because unlike the daemon archives they are resolved before any version is
known — the documented command is
`…/releases/latest/download/install.sh`, never a branch URL. What runs is
therefore the script that was published alongside the archives it installs.

### `install.sh` and `install.ps1` depend on this exact layout

Both scripts (repository root) resolve a release from GitHub Release URLs only
— the `/releases/latest` redirect, the `/releases.atom` feed, and
`/releases/download/<tag>/<asset>`. There is no GitHub JSON API call, and
`install.sh` therefore needs no `jq`: `curl`, `tar` and a SHA-256 tool are the
whole toolchain.

They download `bookmarks-but-better-<version>-<target>.<tar.gz|zip>` and its
`.sha256` by that exact name, verify the checksum, and unpack expecting the
`bookmarks-but-better-<version>-<target>/` top-level directory shown above.
Changing the archive name, the checksum sidecar's naming (`<archive>.sha256`,
content `<hash>  <filename>`), or the top-level directory inside the archive is
a breaking change for both scripts and needs to update them alongside
`release.yml`.

Both also default to the latest _stable_ release. A stable release carrying no
daemon archive — every one up to and including `v3.2.0` — is reported rather
than failed on, and each falls back to the newest prerelease that does have a
build for the platform (see [DAEMON.md](DAEMON.md)). The fallback is not a
switch anyone has to flip off later: a stable release that ships daemon
archives is resolved and installed normally, and the fallback stops being
reached.

Because a tag shape here is either `vX.Y.Z` or `vX.Y.Z-beta.N` and nothing
else, both scripts read "is this a prerelease" straight off the tag. Adding a
third tag shape to `on.push.tags` would need both of them updated.

### `npx bookmarks-but-better@latest`

`packages/bookmarks-but-better` is the Daemon Manager
([ADR-0006](adr/0006-manage-the-daemon-from-an-npm-tool-and-keep-management-out-of-its-api.md)):
`status`, `install`, `uninstall` and `vault add|remove|list`, for people who
have Node.js. It has a **version of its own**, so a fix to the manager ships
without a daemon release, and it names the daemon release it installs by
default in its `package.json` under `daemon.version` — the `validate` job
checks that field against the tag, since that is the daemon whose `--json`
output the manager reads. It ships **no binaries**: it downloads the installer
for the platform it is running on, verifies it against the `.sha256` sidecar
published next to it, runs it with `--version v<daemon.version>`, and
afterwards drives the installed binary's own commands.

Publishing it is a **manual step** — the release pipeline holds no npm
credential:

```sh
cd packages/bookmarks-but-better
npm version <major.minor.patch> --no-git-tag-version   # the manager's own version
npm publish                                            # after the GitHub release it names exists
```

Commit the version bump (and, on a product release, the new `daemon.version`)
like any other change; `npm` is used for nothing else in this repository.
Publish **after** the stable GitHub release named by `daemon.version` exists,
never before: a published manager asks for exactly that archive. Betas are not
published to npm; a prerelease is tried from a checkout, or with
`npx bookmarks-but-better install --version v4.2.0-beta.1`, and `status` then
treats a prerelease of the same line as that line.

The root `package.json` stays `"private": true` and is never published; the
name `bookmarks-but-better` on npm belongs to the manager.

### What CI proves about them

`.github/workflows/ci.yml`'s `install-scripts` job guards all three —
`shellcheck`, a syntax check of `install.ps1`, `tests/install/smoke-test.sh`,
and the manager's own tests and a `npm pack --dry-run`.

The smoke test runs `install.sh` end to end (release resolution, download,
checksum verification, unpack, symlink swap, upgrade, rollback-on-tamper)
against a locally served fake release that speaks the same three GitHub
endpoints. The manager tests cover its platform, argument, URL and status
decisions, which are pure functions, so neither touches the network. Neither runs on a
tag, so together they do not prove the scripts work against a _real_ published
release — only that they still do exactly what they did the last time this
suite ran.

## One-time repository setup

This is the part that cannot live in git. **It is done** — recorded here so the
state is auditable and so it can be rebuilt if the repository is ever recreated.

Current state:

| Item                                               | Status                                         |
| -------------------------------------------------- | ---------------------------------------------- |
| `production-stores` environment                    | exists                                         |
| Required reviewer                                  | set                                            |
| Deployment rule: `v*` tags                         | set                                            |
| `PRODUCTION_STORES_CONFIGURED` (environment scope) | set                                            |
| Six store credentials                              | repository scope, **by decision** — see step 2 |
| `v*` tag ruleset                                   | optional, see step 4                           |

Nothing on this page blocks a release.

> **Why it fails closed.** GitHub _auto-creates_ an environment the first time a
> workflow names one, with no protection rules — no reviewers, no secrets. A
> repository that skipped this setup would therefore look identical to one that
> did it, and would publish on the first stable tag with nobody asked. The canary
> in step 3 is what makes those two states distinguishable.

### 1. Create the environment

**Settings → Environments → New environment → `production-stores`**

- Add **required reviewers** — the people allowed to approve a store
  publication. Without this the environment provides no gate at all: the job
  would run straight through.
- For **Deployment branches and tags**, choose **Selected branches and tags** and
  add a **tag** rule matching `v*`.

  Do **not** choose _Protected branches only_. It excludes tags entirely, and
  every release here is tag-triggered, so that setting makes all store
  publishing fail permanently. There is no "protected branches _and tags_"
  option; the three choices are _All branches_, _Protected branches only_, and
  _Selected branches and tags_.

### 2. The six store credentials stay at **repository** scope

These already exist as **repository** secrets and are deliberately left there.
Names are unchanged from the previous workflow:

| Secret                 | Used for         | Scope      |
| ---------------------- | ---------------- | ---------- |
| `CHROME_EXTENSION_ID`  | Chrome Web Store | repository |
| `CHROME_CLIENT_ID`     | Chrome Web Store | repository |
| `CHROME_CLIENT_SECRET` | Chrome Web Store | repository |
| `CHROME_REFRESH_TOKEN` | Chrome Web Store | repository |
| `AMO_JWT_ISSUER`       | Firefox AMO      | repository |
| `AMO_JWT_SECRET`       | Firefox AMO      | repository |

Nothing needs doing here before a release. An environment job reads repository
secrets perfectly well — environment secrets merely _shadow_ same-named
repository ones — so the pipeline works as it stands.

**Why they were not moved.** GitHub never returns a stored secret's value, not
through the UI and not through the API, so a secret cannot be copied from one
scope to another. Moving these would mean regenerating each one at its source —
and generating a new AMO API key **revokes the live one**. That is a real risk to
a working release path in exchange for no change to the approval gate.

**This does not weaken the gate.** Approval is enforced by the _environment
attached to the job_, not by where the secrets are stored. `publish-stores` names
`production-stores`, so GitHub holds the whole job — every step, before any of
them runs — until a required reviewer approves it. That is true regardless of
which scope the credentials come from.

**What repository scope does cost** is exposure: a repository secret is readable
by **any job in this workflow**, including jobs that name no environment and jobs
added later by someone who never read this page. The environment gate protects
the job that opts into it; it does not protect the others.

That is a defence-in-depth argument, not a release blocker — see
[Optional hardening](#5-optional-hardening-move-the-store-credentials) if you
decide to take it on later.

### 3. The canary — the one secret that must be environment-only

One **environment** secret on `production-stores`:

| Secret                         | Value                           | Scope                |
| ------------------------------ | ------------------------------- | -------------------- |
| `PRODUCTION_STORES_CONFIGURED` | any non-empty value, e.g. `yes` | **environment only** |

The value is never read, logged, or compared — only its existence is. It is the
signal that this page was filled in by a person rather than conjured by GitHub,
which is why it is a _different name_ from the six credentials: those are
expected at repository scope, and this one must never be.

> **Rule: `PRODUCTION_STORES_CONFIGURED` must never exist at repository scope.**
> Not as a secret, not as a variable. If it ever does, the guard passes forever
> and the protection is silently gone with nothing in any log to show for it.
> This is the fail-closed invariant the whole setup check rests on, and it is
> unaffected by the six credentials living at repository scope.

**What the canary proves:** the environment was configured deliberately, rather
than auto-created empty by GitHub the first time the workflow named it.

**What it says nothing about, by design:** where the six store credentials live.
They are repository-scoped on purpose (step 2), so there is no scope check to
make here and nothing for the canary to detect. The canary's job is to tell a
configured environment from an auto-created one — not to audit credential
placement.

There is a second guard in the job that checks all six credential names resolve
to a non-empty value. It is a **partial-publish** guard, not a configuration
check: Chrome is submitted before Firefox, so a credential missing from _every_
scope would publish to one store and strand the other. It says nothing about
which scope supplied a value, and does not need to.

### 4. Recommended: protect the `v*` tags

Not required, and not something the pipeline can enforce. Anyone with push access
can currently create or force-move a `v*` tag and start a release; a force-moved
tag re-triggers the workflow and updates the existing release in place.

**Settings → Rules → Rulesets → New ruleset**, target **Tag**, pattern `v*`,
blocking **deletion** and **non-fast-forward**.

### 5. Optional hardening: move the store credentials

**Not required, and not a release prerequisite.** The pipeline is correct as it
stands and the approval gate is unaffected. This only narrows the blast radius
described in step 2: repository secrets are readable by every job in this
workflow, not just the one that opts into the environment.

If you take it on, the order matters, because you cannot copy a secret — each
value has to be regenerated at its source, and one of them revokes the live
credential when you do:

1. **Regenerate** the credential at its source.
   - Chrome — the Google Cloud OAuth client and refresh token for the Web Store
     API.
   - AMO — a new key from
     <https://addons.mozilla.org/developers/addon/api/key/>. **Generating it
     revokes the current one**, so the release path is broken from this moment
     until step 3.
2. **Add** it as an environment secret on `production-stores`, same name.
3. **Verify** with a real dispatch recovery against an already-published tag —
   this is the only way to confirm the new value works.
4. **Delete** the repository-scoped copy, last.

Do not delete first. A deleted repository copy with no working environment
secret leaves no path to publish, and the AMO regeneration in step 1 means the
old value is already gone.

### Nothing else

`GITHUB_TOKEN` is automatic. The workflow is read-only by default and raises
`contents: write` on the single job that creates the release.

### Checklist

Required — all done:

- [x] `production-stores` environment exists
- [x] Required reviewer added
- [x] Deployment rule is _Selected branches and tags_ with a `v*` **tag** rule
- [x] `PRODUCTION_STORES_CONFIGURED` added, **environment scope only**
- [x] Six store credentials present at repository scope (deliberate; step 2)

Optional, any time:

- [ ] `v*` tag ruleset (step 4)
- [ ] Store credentials moved to environment scope (step 5)
