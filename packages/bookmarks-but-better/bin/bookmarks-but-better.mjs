#!/usr/bin/env node
// `npx bookmarks-but-better@latest`
//
// This package ships no binaries. It downloads the official installer for this
// platform from the GitHub Release — install.sh on macOS and Linux, install.ps1
// on Windows, both fixed-name release assets — verifies it against its
// published SHA-256 sidecar, and runs it.
//
// The installer is what does the actual work, and it is the same script the
// documented `curl … | bash` command runs: it downloads the versioned daemon
// archive for this platform, verifies *that* against its own checksum, unpacks
// it into a user-local directory, points a `current` symlink at it and runs
// `bookmarks-but-better setup`. So the install is persistent — `npx` is only
// how the installer got here, not where the daemon lives.
//
// Every decision this file makes lives in ../lib/launcher.mjs, which is pure
// and tested; what is left here is the I/O.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  DEFAULT_GITHUB_BASE,
  USAGE,
  checksumAssetName,
  commandFor,
  installerAssetName,
  parseArgs,
  parseChecksumSidecar,
  releaseAssetUrl,
  releaseTagFor,
} from "../lib/launcher.mjs";

const GITHUB_BASE =
  process.env.BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE || DEFAULT_GITHUB_BASE;

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const { help, forwarded, errors, version } = parseArgs(process.argv.slice(2));
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`error: ${error}\n`);
    process.stderr.write(`\n${USAGE}\n`);
    process.exit(1);
  }
  if (help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const tag = releaseTagFor({ version });
  const assetName = installerAssetName(process.platform);
  const installerUrl = releaseAssetUrl({
    name: assetName,
    tag,
    base: GITHUB_BASE,
  });
  const checksumUrl = releaseAssetUrl({
    name: checksumAssetName(assetName),
    tag,
    base: GITHUB_BASE,
  });

  // Resolved before anything is downloaded: a flag with no equivalent on this
  // platform is a refusal, not something to discover after an install started.
  const scratch = await mkdtemp(join(tmpdir(), "bookmarks-but-better-"));
  const scriptPath = join(scratch, assetName);
  let invocation;
  try {
    invocation = commandFor({
      platform: process.platform,
      scriptPath,
      forwarded,
    });
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    fail(error.message);
    return;
  }

  try {
    process.stderr.write(`downloading ${assetName} from ${installerUrl}\n`);
    const [installer, sidecar] = await Promise.all([
      download(installerUrl),
      download(checksumUrl),
    ]);

    const expected = parseChecksumSidecar(sidecar.toString("utf8"));
    const actual = createHash("sha256").update(installer).digest("hex");
    if (expected !== actual) {
      throw new Error(
        `checksum verification failed for ${assetName} (expected ${expected}, got ${actual}) — refusing to run a corrupted or tampered installer`,
      );
    }
    process.stderr.write("verified the installer against its published SHA-256\n");

    await writeFile(scriptPath, installer, { mode: 0o700 });

    const code = await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        stdio: "inherit",
        env: {
          ...process.env,
          BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE: GITHUB_BASE,
        },
      });
      child.on("error", reject);
      child.on("close", resolve);
    });
    process.exitCode = code ?? 1;
  } catch (error) {
    fail(error.message);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
