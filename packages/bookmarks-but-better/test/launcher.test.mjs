// Every decision `npx bookmarks-but-better@latest` makes, checked without a
// network, a temporary directory or a spawned process. The launcher's I/O is
// deliberately confined to bin/bookmarks-but-better.mjs so that platform,
// argument and URL behaviour can be tested exactly like this.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GITHUB_BASE,
  REPO,
  SUPPORTED_FLAGS,
  USAGE,
  checksumAssetName,
  commandFor,
  installerAssetName,
  parseArgs,
  parseChecksumSidecar,
  releaseAssetUrl,
  releaseTagFor,
} from "../lib/launcher.mjs";

test("each platform gets its own fixed-name installer asset", () => {
  assert.equal(installerAssetName("win32"), "install.ps1");
  assert.equal(installerAssetName("darwin"), "install.sh");
  assert.equal(installerAssetName("linux"), "install.sh");
  // Anything not Windows is a POSIX shell as far as the release assets go;
  // install.sh itself refuses an OS it has no build for.
  assert.equal(installerAssetName("freebsd"), "install.sh");
});

test("asset URLs are GitHub Release URLs, never a branch or the website", () => {
  const latest = releaseAssetUrl({ name: "install.sh" });
  assert.equal(
    latest,
    "https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh",
  );

  const pinned = releaseAssetUrl({ name: "install.ps1", tag: "v4.0.0" });
  assert.equal(
    pinned,
    "https://github.com/farhadeidi/bookmarks-but-better/releases/download/v4.0.0/install.ps1",
  );

  for (const url of [latest, pinned]) {
    assert.ok(url.startsWith(`${DEFAULT_GITHUB_BASE}/${REPO}/releases/`));
    assert.ok(!url.includes("raw.githubusercontent.com"));
    assert.ok(!url.includes("bookmarks.farhadeidi.com"));
  }
});

test("a base override does not leak a double slash into the URL", () => {
  assert.equal(
    releaseAssetUrl({ name: "install.sh", base: "http://127.0.0.1:9000/" }),
    "http://127.0.0.1:9000/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh",
  );
});

test("the checksum sidecar sits next to the asset it covers", () => {
  assert.equal(checksumAssetName("install.sh"), "install.sh.sha256");
  assert.equal(
    releaseAssetUrl({ name: checksumAssetName("install.sh"), tag: "v4.0.0" }),
    "https://github.com/farhadeidi/bookmarks-but-better/releases/download/v4.0.0/install.sh.sha256",
  );
});

test("a sidecar is read as `<hash>  <filename>` and nothing looser", () => {
  const hash = "a".repeat(64);
  assert.equal(parseChecksumSidecar(`${hash}  install.sh\n`), hash);
  assert.equal(parseChecksumSidecar(`${hash.toUpperCase()}  install.sh`), hash);
  assert.throws(() => parseChecksumSidecar("not a hash  install.sh"));
  assert.throws(() => parseChecksumSidecar(""));
  // A truncated download must not be read as a shorter, matching hash.
  assert.throws(() => parseChecksumSidecar(`${"a".repeat(63)}  install.sh`));
});

test("supported flags are forwarded verbatim, in order, with their values", () => {
  const parsed = parseArgs([
    "--beta",
    "--install-dir",
    "/opt/bookmarks",
    "--skip-setup",
  ]);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.help, false);
  assert.deepEqual(parsed.forwarded, [
    "--beta",
    "--install-dir",
    "/opt/bookmarks",
    "--skip-setup",
  ]);
});

test("every advertised flag parses", () => {
  for (const flag of SUPPORTED_FLAGS) {
    const argv = flag === "--beta" || flag === "--skip-setup" ? [flag] : [flag, "value"];
    const parsed = parseArgs(argv);
    assert.deepEqual(parsed.errors, [], `${flag} should parse`);
    assert.ok(USAGE.includes(flag), `${flag} should be documented in --help`);
  }
});

test("an unknown flag is refused here rather than forwarded", () => {
  const parsed = parseArgs(["--make-coffee"]);
  assert.deepEqual(parsed.forwarded, []);
  assert.deepEqual(parsed.errors, ["unrecognized argument: --make-coffee"]);
});

test("a value-taking flag with no value is refused", () => {
  assert.deepEqual(parseArgs(["--version"]).errors, ["--version needs an argument"]);
  // The next flag is not swallowed as if it were the value.
  const parsed = parseArgs(["--version", "--beta"]);
  assert.deepEqual(parsed.errors, ["--version needs an argument"]);
  assert.deepEqual(parsed.forwarded, ["--beta"]);
});

test("-h and --help ask for help without forwarding anything", () => {
  for (const flag of ["-h", "--help"]) {
    const parsed = parseArgs([flag]);
    assert.equal(parsed.help, true);
    assert.deepEqual(parsed.forwarded, []);
    assert.deepEqual(parsed.errors, []);
  }
});

test("--version pins the installer to the same release as the daemon", () => {
  assert.equal(releaseTagFor({ version: "v4.0.0" }), "v4.0.0");
  // The installers accept a tag with or without the leading v; the release
  // asset path only exists under the real tag.
  assert.equal(releaseTagFor({ version: "4.0.0" }), "v4.0.0");
  assert.equal(releaseTagFor({ version: "4.0.0-beta.1" }), "v4.0.0-beta.1");
  assert.equal(releaseTagFor({ version: null }), null);
});

test("--version reaches both the parse result and the forwarded arguments", () => {
  const parsed = parseArgs(["--version", "v4.0.0"]);
  assert.equal(parsed.version, "v4.0.0");
  assert.deepEqual(parsed.forwarded, ["--version", "v4.0.0"]);
});

test("POSIX runs install.sh under bash, never sh", () => {
  const { command, args } = commandFor({
    platform: "linux",
    scriptPath: "/tmp/x/install.sh",
    forwarded: ["--beta"],
  });
  // `set -o pipefail` is a bash builtin option, and /bin/sh is dash on Debian
  // and Ubuntu, where the script dies on that line before it can say why.
  assert.equal(command, "bash");
  assert.deepEqual(args, ["/tmp/x/install.sh", "--beta"]);
});

test("Windows runs install.ps1 with its own parameter names", () => {
  const { command, args } = commandFor({
    platform: "win32",
    scriptPath: "C:\\Temp\\install.ps1",
    forwarded: ["--beta", "--version", "v4.0.0", "--install-dir", "C:\\Bookmarks", "--skip-setup"],
  });
  assert.equal(command, "powershell");
  assert.deepEqual(args, [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "C:\\Temp\\install.ps1",
    "-Beta",
    "-Version",
    "v4.0.0",
    "-InstallDir",
    "C:\\Bookmarks",
    "-SkipSetup",
  ]);
});

test("Windows is never run non-interactively: setup asks questions", () => {
  const { args } = commandFor({
    platform: "win32",
    scriptPath: "C:\\Temp\\install.ps1",
  });
  assert.ok(!args.includes("-NonInteractive"));
});

test("a flag Windows has no equivalent for is refused, not dropped", () => {
  assert.throws(
    () =>
      commandFor({
        platform: "win32",
        scriptPath: "C:\\Temp\\install.ps1",
        forwarded: ["--bin-dir", "C:\\bin"],
      }),
    /--bin-dir is not supported on Windows/,
  );
  // The same flag is fine everywhere else.
  assert.deepEqual(
    commandFor({
      platform: "darwin",
      scriptPath: "/tmp/install.sh",
      forwarded: ["--bin-dir", "/usr/local/bin"],
    }).args,
    ["/tmp/install.sh", "--bin-dir", "/usr/local/bin"],
  );
});

test("setup runs by default: nothing is added to skip it", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    const { args } = commandFor({
      platform,
      scriptPath: platform === "win32" ? "C:\\install.ps1" : "/tmp/install.sh",
    });
    assert.ok(!args.includes("--skip-setup"));
    assert.ok(!args.includes("-SkipSetup"));
  }
});
