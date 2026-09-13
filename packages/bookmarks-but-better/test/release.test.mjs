// Which installer, from where, run how — checked without a network, a
// temporary directory or a spawned process.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GITHUB_BASE,
  REPO,
  checksumAssetName,
  commandFor,
  installerAssetName,
  parseChecksumSidecar,
  releaseAssetUrl,
  releaseTagFor,
} from "../lib/release.mjs";

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
    assert.ok(!url.includes("bookmarks.but-better.dev"));
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

test("the installer is fetched from the release it will install", () => {
  assert.equal(releaseTagFor(["--version", "v4.1.0", "--vault", "/v"]), "v4.1.0");
  // The installers accept a tag with or without the leading v; the release
  // asset path only exists under the real tag.
  assert.equal(releaseTagFor(["--version", "4.1.0-beta.1"]), "v4.1.0-beta.1");
  // Never the floating latest release: the tool knows which daemon it drives.
  assert.throws(() => releaseTagFor(["--vault", "/v"]), /no --version/);
});

test("POSIX runs install.sh under bash, never sh, with the flags verbatim", () => {
  const { command, args } = commandFor({
    platform: "linux",
    scriptPath: "/tmp/x/install.sh",
    forwarded: ["--version", "v4.1.0", "--vault", "/home/me/Bookmarks"],
  });
  assert.equal(command, "bash");
  assert.deepEqual(args, ["/tmp/x/install.sh", "--version", "v4.1.0", "--vault", "/home/me/Bookmarks"]);
});

test("Windows runs install.ps1 non-interactively with every flag translated", () => {
  const { command, args } = commandFor({
    platform: "win32",
    scriptPath: "C:\\Temp\\install.ps1",
    forwarded: ["--version", "v4.1.0", "--install-dir", "D:\\bbb", "--vault", "D:\\Bookmarks"],
  });
  assert.equal(command, "powershell");
  assert.ok(args.includes("-NonInteractive"), "the installer asks nothing, so nothing may wait on a prompt");
  assert.deepEqual(args.slice(args.indexOf("-File")), [
    "-File",
    "C:\\Temp\\install.ps1",
    "-Version",
    "v4.1.0",
    "-InstallDir",
    "D:\\bbb",
    "-Vault",
    "D:\\Bookmarks",
  ]);
});

test("a flag with no Windows equivalent is refused before anything runs", () => {
  assert.throws(
    () => commandFor({ platform: "win32", scriptPath: "x.ps1", forwarded: ["--bin-dir", "C:\\bin"] }),
    /--bin-dir is not supported on Windows/,
  );
  assert.throws(() => commandFor({ platform: "win32", scriptPath: "x.ps1", forwarded: ["--wat"] }), /cannot forward/);
});
