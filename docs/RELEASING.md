# Releasing

One number ships everything. `package.json`, both extension manifests and the
Cargo workspace all carry the same product version, and a tag is what turns that
version into a release.

Two commands do the whole job:

```sh
git push origin v4.0.0-beta.1   # a prerelease: artifacts to download, no store
git push origin v4.0.0          # the real thing: stores, after an approval
```

Nothing else publishes. Merging to `main` runs [`ci.yml`](../.github/workflows/ci.yml)
and stops there.

## What each tag does

| You push          | You get                                                                  | Stores                                       |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| `v4.0.0-beta.N`   | A GitHub **prerelease** with both extension zips and five daemon archives | **Never contacted.** The job does not exist.  |
| `v4.0.0`          | A normal GitHub **Release** with the same artifacts                      | After a maintainer approves the deployment.   |

Both run the identical build and the identical test suite — the release workflow
calls `ci.yml` rather than keeping a second copy of the gates that could drift
from it. A beta is a real build; the only thing it does not do is publish.

## Cutting a beta

1. Reconcile the version everywhere. For `4.0.0` that means `4.0.0` — exactly
   this string — in all six places:

   - `package.json`
   - `manifests/manifest.chrome.json`
   - `manifests/manifest.firefox.json`
   - `Cargo.toml` (`[workspace.package] version`)
   - `crates/bbb/Cargo.toml` (the `bbb-vault-core` constraint, twice)
   - `Cargo.lock` — run `cargo update --workspace` after the two above

2. Add a `## [4.0.0]` section to `CHANGELOG.md`.

3. Tag and push:

   ```sh
   git tag v4.0.0-beta.1
   git push origin v4.0.0-beta.1
   ```

The `validate` job checks every one of those before anything is built, and fails
with the file and both values when one disagrees. Getting it wrong costs a minute,
not a bad release.

### Betas keep the plain version, on purpose

A beta tag is `v4.0.0-beta.1`, but every manifest inside it still reads `4.0.0`.
That is not an oversight and must not be "fixed":

- Chrome accepts one to four dot-separated integers as a version and nothing
  else. `4.0.0-beta.1` is not a valid extension version.
- AMO rejects it too.

So the beta-ness lives in the tag and in the GitHub prerelease, never in a
manifest. The artifact *filenames* carry the full tag (`…-chrome-4.0.0-beta.1.zip`)
so a downloaded build is still identifiable, and the release notes say so. The
`validate` job enforces both halves: manifests must equal the base version, and
must be numeric.

Iterating means `-beta.2`, `-beta.3`, and so on. All of them build `4.0.0`
manifests. That is fine, because no store ever sees them.

## Cutting the stable release

```sh
git tag v4.0.0
git push origin v4.0.0
```

The build, the tests, the GitHub Release and its artifacts all happen without
anyone doing anything. Then the run **stops and waits**: `publish-stores` is
attached to the `production-stores` environment, and GitHub will not start it
until a required reviewer approves the deployment from the run page.

That pause depends entirely on the environment having **required reviewers**. An
environment without them holds nothing. See [One-time repository
setup](#one-time-repository-setup) — and note the job now refuses to run at all
unless that setup was done.

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

## Recovery: re-running a store submission

> **"Re-run failed jobs" is not the recovery mechanism — for any run.** It
> publishes nothing, by design. Store submission is limited to the **first
> attempt**, of a tag push *and* of a manual dispatch alike, and a re-run writes
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
> tell the two situations apart. Without the limit it would re-run *both* store
> steps with neither toggle consulted; and if the previous attempt *did* reach a
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
   (`gh release create v4.0.0 artifacts/*`), then dispatch for the stores.

Do not skip this. A dispatch **refuses to run** unless a published release
already exists for the tag — see [What stops an accidental
publication](#what-stops-an-accidental-publication) — so a dispatch against a
tag with no release fails after you have already approved the deployment.

### Then: dispatch for the stores

Whether a store failed or the run never got that far, the way to publish is the
same — run the workflow manually:

1. **Actions → Release → Run workflow**.
2. Under **Use workflow from**, pick the **tag** (`v4.0.0`), not a branch. A
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
   environment carries `PRODUCTION_STORES_CONFIGURED` — see below for why that
   is necessary and, just as importantly, what it does *not* prove.

Store submission is additionally limited to the **first attempt of a run** — a
tag push *or* a manual dispatch — and so is creating the GitHub release. A re-run
can neither publish to a store nor overwrite a release that already exists.

A **manual dispatch** carries one more precondition, because its whole premise is
that it is *finishing* a release rather than starting one. Before any credential
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

| Target                       | Archive   |
| ---------------------------- | --------- |
| `x86_64-unknown-linux-gnu`   | `.tar.gz` |
| `aarch64-unknown-linux-gnu`  | `.tar.gz` |
| `x86_64-apple-darwin`        | `.tar.gz` |
| `aarch64-apple-darwin`       | `.tar.gz` |
| `x86_64-pc-windows-msvc`     | `.zip`    |

Each unpacks to:

```
bbb-<version>-<target>/
  bbb[.exe]      the daemon, HTTP API and CLI
  ui/            the built web UI
  README.md
  LICENSE
```

```sh
./bbb serve --vault <path-to-your-vault> --ui-dir ./ui
```

The daemon does not compile the UI into the binary — `crates/bbb/src/ui.rs`
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
`xattr -d com.apple.quarantine ./bbb` on macOS or *More info → Run anyway* on
Windows. The release notes say so on every release.

Changing that means buying an Apple Developer account and a code-signing
certificate, and adding signing keys to the release pipeline. Until then the
`.sha256` files are what a cautious user has to go on.

## One-time repository setup

This is the part that cannot live in git, and **it must be done before the first
`v4.0.0` tag is pushed.** Until it is, the release pipeline refuses to publish.

> **Why it fails closed.** GitHub *auto-creates* an environment the first time a
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

  Do **not** choose *Protected branches only*. It excludes tags entirely, and
  every release here is tag-triggered, so that setting makes all store
  publishing fail permanently. There is no "protected branches *and tags*"
  option; the three choices are *All branches*, *Protected branches only*, and
  *Selected branches and tags*.

### 2. Add the six store credentials as **environment** secrets

On `production-stores`, *not* at repository scope. Names are unchanged from the
previous workflow:

| Secret                  | Used for                     |
| ----------------------- | ---------------------------- |
| `CHROME_EXTENSION_ID`   | Chrome Web Store             |
| `CHROME_CLIENT_ID`      | Chrome Web Store             |
| `CHROME_CLIENT_SECRET`  | Chrome Web Store             |
| `CHROME_REFRESH_TOKEN`  | Chrome Web Store             |
| `AMO_JWT_ISSUER`        | Firefox AMO                  |
| `AMO_JWT_SECRET`        | Firefox AMO                  |

**There is no way to move a secret.** GitHub never returns a secret's value —
not through the UI, not through the API — so these cannot be copied from
repository scope to environment scope programmatically or by anyone who does not
already hold the values. Each one has to be **re-entered from its original
source**:

- Chrome — the Google Cloud OAuth client and refresh token used for the Web
  Store API.
- AMO — the JWT issuer and secret from
  <https://addons.mozilla.org/developers/addon/api/key/>. Generating a new AMO
  key **revokes the previous one**, so do this once and paste it straight in.

Then **delete the repository-scoped copies.**

Be clear about why, because the usual reason given is wrong. With the
environment created and reviewers required, the approval gate holds *even if the
repository copies are left in place* — approval is enforced by the environment,
not by where the secrets live. The reason to delete them is defence in depth:
a repository secret is readable by **any job in this workflow**, including jobs
that reference no environment at all and jobs added later by someone who never
read this page. The gate protects the job that opts into it; repository secrets
are exposed to every job that does not.

### 3. Add the canary — do this last

Add one more **environment** secret on `production-stores`:

| Secret                          | Value                          |
| ------------------------------- | ------------------------------ |
| `PRODUCTION_STORES_CONFIGURED`  | any non-empty value, e.g. `yes` |

The value is never read, logged, or compared — only its existence is. It is the
signal that this page was filled in by a person rather than conjured by GitHub.

> **Rule: `PRODUCTION_STORES_CONFIGURED` must never exist at repository scope.**
> Not as a secret, not as a variable. If it ever does, the guard passes forever
> and the protection is silently gone with nothing in any log to show for it.

**What the canary proves:** the environment was configured deliberately.

**What it cannot prove, and must not be read as proving:** that the six
credentials are environment-scoped. Repository secrets remain readable inside an
environment job — environment secrets only *shadow* same-named repository ones —
so a half-migrated setup resolves its credentials from the repository and no
check in the workflow can detect it. Step 2's deletion is a human step, and this
is the reason it stays one.

There is a second guard in the job that checks all six credential names resolve
to a non-empty value. It is a **partial-publish** guard, not a configuration
check: Chrome is submitted before Firefox, so a credential missing from *every*
scope would publish to one store and strand the other. It says nothing about
which scope supplied a value.

### 4. Recommended: protect the `v*` tags

Not required, and not something the pipeline can enforce. Anyone with push access
can currently create or force-move a `v*` tag and start a release; a force-moved
tag re-triggers the workflow and updates the existing release in place.

**Settings → Rules → Rulesets → New ruleset**, target **Tag**, pattern `v*`,
blocking **deletion** and **non-fast-forward**.

### Nothing else

`GITHUB_TOKEN` is automatic. The workflow is read-only by default and raises
`contents: write` on the single job that creates the release.

### Checklist

- [ ] `production-stores` environment exists
- [ ] Required reviewers added
- [ ] Deployment rule is *Selected branches and tags* with a `v*` **tag** rule
- [ ] Six credentials re-entered as environment secrets
- [ ] Repository-scoped copies of those six deleted
- [ ] `PRODUCTION_STORES_CONFIGURED` added, environment scope only
- [ ] (Recommended) `v*` tag ruleset
