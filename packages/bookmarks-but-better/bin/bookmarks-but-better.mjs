#!/usr/bin/env node
// `npx bookmarks-but-better`: the Daemon Manager (ADR-0006).
//
// Six verbs — `status`, `install`, `uninstall`, `vault list|add|remove` — and
// nothing that reads or changes a bookmark. Everything it does is one of two
// things: run the daemon binary's own non-interactive commands and read their
// `--json` answers, or run the official installer for this platform, fetched
// from the GitHub Release and verified against its published SHA-256. The
// questions live here; the daemon asks none.
//
// Every decision is in ../lib, which is pure and tested. This file is the I/O.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { USAGE, installerFlags, parseArgs } from "../lib/cli.mjs";
import * as daemon from "../lib/daemon.mjs";
import { configPath, contractHome, expandHome, installLayout } from "../lib/layout.mjs";
import { createPrompter } from "../lib/prompt.mjs";
import {
  DEFAULT_GITHUB_BASE,
  checksumAssetName,
  commandFor,
  installerAssetName,
  parseChecksumSidecar,
  releaseAssetUrl,
  releaseTagFor,
} from "../lib/release.mjs";
import { render, toJson } from "../lib/status.mjs";

const GITHUB_BASE = process.env.BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE || DEFAULT_GITHUB_BASE;
const HOME = homedir();
// The file that makes a directory a vault; the daemon writes it on `init`.
const VAULT_MARKER = ".bookmarks-but-better-folder.md";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const TOOL_VERSION = packageJson.version;

const say = (text) => process.stderr.write(`${text}\n`);
const out = (text) => process.stdout.write(`${text}\n`);
const home = (value) => contractHome(value, HOME);

class Failure extends Error {}
function fail(message) {
  throw new Failure(message);
}

function requireInstalled(layout) {
  if (!existsSync(layout.binary)) {
    fail("the daemon is not installed; run: npx bookmarks-but-better install");
  }
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Fetches, verifies and runs this platform's installer with `flags`. */
async function runInstaller(flags) {
  const tag = releaseTagFor(flags);
  const assetName = installerAssetName(process.platform);
  const installerUrl = releaseAssetUrl({ name: assetName, tag, base: GITHUB_BASE });
  const checksumUrl = releaseAssetUrl({ name: checksumAssetName(assetName), tag, base: GITHUB_BASE });

  const scratch = await mkdtemp(path.join(tmpdir(), "bookmarks-but-better-"));
  const scriptPath = path.join(scratch, assetName);
  try {
    // Resolved before anything is downloaded: a flag with no equivalent on
    // this platform is a refusal, not something to discover mid-install.
    const invocation = commandFor({ platform: process.platform, scriptPath, forwarded: flags });

    say(`downloading ${assetName} from ${installerUrl}`);
    const [installer, sidecar] = await Promise.all([download(installerUrl), download(checksumUrl)]);
    const expected = parseChecksumSidecar(sidecar.toString("utf8"));
    const actual = createHash("sha256").update(installer).digest("hex");
    if (expected !== actual) {
      fail(
        `checksum verification failed for ${assetName} (expected ${expected}, got ${actual}); refusing to run a corrupted or tampered installer`,
      );
    }
    say("verified the installer against its published SHA-256");
    await writeFile(scriptPath, installer, { mode: 0o700 });

    const code = await daemon.runVisible(invocation.command, invocation.args, {
      env: { ...process.env, BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE: GITHUB_BASE },
    });
    if (code !== 0) fail(`the installer stopped with exit code ${code}`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Reads the machine and prints the report; a bad state is an answer, not a failure. */
async function status({ layout, options }) {
  const report = await daemon.gather({ layout, toolVersion: TOOL_VERSION });
  if (options.json) {
    out(JSON.stringify(toJson(report), null, 2));
  } else {
    out(render(report, { homedir: HOME }));
  }
  return 0;
}

/**
 * Installs or updates. The one question — where the first vault lives — is
 * asked only when nothing is configured yet, before the installer runs, so
 * the installer itself can do the whole first run with `--vault` and never
 * has to ask anything.
 */
async function install({ layout, options, prompter }) {
  const installed = existsSync(layout.binary);
  let needsVault = !installed;
  if (installed) {
    needsVault = (await daemon.registryHasVaults(layout.binary)) === false;
  }

  let vault = options.vault ? expandHome(options.vault, HOME) : null;
  if (needsVault && !vault) {
    say(installed ? "the daemon is installed but no vault is configured yet" : "installing the daemon");
    vault = expandHome(
      await prompter.ask("Where should your bookmarks live?", path.join(HOME, "Bookmarks")),
      HOME,
    );
  }
  if (vault) vault = path.resolve(vault);

  await runInstaller(installerFlags({ options, toolVersion: TOOL_VERSION, vault }));

  say("");
  const report = await daemon.gather({ layout, toolVersion: TOOL_VERSION });
  if (!report.health && report.service?.state === "running") {
    // Just started: give it the moment it needs to open its vaults.
    try {
      report.health = await daemon.waitForHealth(report.origin);
      report.healthError = null;
    } catch (error) {
      report.healthError = error.message;
    }
  }
  out(render(report, { homedir: HOME }));
  return 0;
}

/**
 * Removes the service and the daemon. Vault directories are never touched,
 * and the configuration file is kept unless asked otherwise — it is one small
 * file, and a later install picks it up again.
 */
async function uninstall({ layout, options, prompter }) {
  const fallbackConfig = configPath({ platform: process.platform, env: process.env, homedir: HOME });

  if (!existsSync(layout.binary)) {
    say(`nothing is installed under ${home(layout.installRoot)}`);
    if (options.purgeConfig && existsSync(fallbackConfig)) {
      await rm(fallbackConfig, { force: true });
      say(`removed ${home(fallbackConfig)}`);
    }
    return 0;
  }

  const { value: registry } = await daemon.readRegistry(layout.binary);
  const config = registry?.configuration ?? fallbackConfig;
  const vaults = registry?.vaults ?? [];

  const go = await prompter.confirm(
    "Remove the daemon and its background service? Your vaults stay where they are.",
    { fallback: true },
  );
  if (!go) {
    say("nothing was removed");
    return 1;
  }

  const code = await daemon.runVisible(layout.binary, ["service", "uninstall"]);
  if (code !== 0) say("the service definition could not be removed cleanly; removing the daemon anyway");

  await rm(layout.installRoot, { recursive: true, force: true });
  if (layout.binLink) await rm(layout.binLink, { force: true });
  if (process.platform === "win32") await daemon.removeFromUserPath(layout.current);
  say(`removed ${home(layout.installRoot)}${layout.binLink ? ` and ${home(layout.binLink)}` : ""}`);

  let purge = Boolean(options.purgeConfig);
  if (!purge && existsSync(config)) {
    purge = await prompter.confirm(`Also remove the configuration at ${home(config)}?`, {
      fallback: false,
      whenYes: false,
    });
  }
  if (purge) {
    await rm(config, { force: true });
    say(`removed ${home(config)}`);
  } else if (existsSync(config)) {
    say(`kept ${home(config)}; a later install picks it up again`);
  }
  for (const vault of vaults) {
    say(`untouched: ${vault.id}  ${home(vault.path)}`);
  }
  return 0;
}

/** Reinstalls the service from the registry — which restarts it — when one is installed. */
async function applyToService({ layout, prompter, why }) {
  const installed = await daemon.serviceIsInstalled(layout.binary);
  if (!installed) {
    say("no background service is installed; `npx bookmarks-but-better install` sets one up");
    return 0;
  }
  const go = await prompter.confirm(`Restart the background service ${why}?`, { fallback: true });
  if (!go) {
    say("the running daemon keeps its current vaults until the service is reinstalled");
    return 0;
  }
  const code = await daemon.applyService(layout);
  if (code !== 0) return code;

  const { value: registry } = await daemon.readRegistry(layout.binary);
  const { value: service } = await daemon.readService(layout.binary);
  const origin = daemon.originOf({ registry, service });
  try {
    const health = await daemon.waitForHealth(origin);
    say(`hosting: ${health.vaults.map((vault) => vault.id).join(", ")}`);
  } catch (error) {
    say(`the daemon has not answered at ${origin} yet (${error.message}); \`npx bookmarks-but-better status\` will say`);
  }
  return 0;
}

function vaultList({ layout, options }) {
  requireInstalled(layout);
  return daemon.runVisible(layout.binary, ["vault", "list", ...(options.json ? ["--json"] : [])]);
}

async function vaultAdd({ layout, args, prompter }) {
  requireInstalled(layout);
  const [id, given] = args;
  const directory = path.resolve(expandHome(given, HOME));

  // A directory that is not a vault yet is made one only on a yes: `--init`
  // is what turns a typo into a vault in the wrong place, so it is never
  // implied.
  let init = false;
  if (!existsSync(path.join(directory, VAULT_MARKER))) {
    init = await prompter.confirm(`${home(directory)} is not a vault yet. Create one there?`, {
      fallback: true,
    });
    if (!init) {
      say("nothing was added");
      return 1;
    }
  }

  const code = await daemon.runVisible(layout.binary, [
    "vault",
    "add",
    id,
    directory,
    ...(init ? ["--init"] : []),
  ]);
  if (code !== 0) return code;
  return applyToService({ layout, prompter, why: `so it hosts \`${id}\`` });
}

async function vaultRemove({ layout, args, prompter }) {
  requireInstalled(layout);
  const [id] = args;
  const go = await prompter.confirm(`Remove \`${id}\` from the configuration? Its directory stays.`, {
    fallback: false,
    whenYes: true,
  });
  if (!go) {
    say("nothing was removed");
    return 1;
  }

  const code = await daemon.runVisible(layout.binary, ["vault", "remove", id]);
  if (code !== 0) return code;

  if ((await daemon.registryHasVaults(layout.binary)) === false) {
    if (await daemon.serviceIsInstalled(layout.binary)) {
      // A service with nothing to serve would fail at every login; a
      // definition still naming the removed vault would serve it anyway.
      say("no vault is left to serve, so the background service is removed too; `vault add` brings it back");
      return daemon.runVisible(layout.binary, ["service", "uninstall"]);
    }
    return 0;
  }
  return applyToService({ layout, prompter, why: `so it stops hosting \`${id}\`` });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) say(`error: ${error}`);
    say("");
    say(USAGE);
    return 2;
  }
  if (parsed.help) {
    out(USAGE);
    return 0;
  }

  const { options } = parsed;
  const layout = installLayout({
    platform: process.platform,
    env: process.env,
    homedir: HOME,
    installDir: options.installDir ? path.resolve(expandHome(options.installDir, HOME)) : null,
    binDir: options.binDir ? path.resolve(expandHome(options.binDir, HOME)) : null,
  });
  const prompter = createPrompter({ yes: Boolean(options.yes) });
  const context = { layout, options, args: parsed.args, prompter };

  switch (parsed.command) {
    case null:
      return existsSync(layout.binary) ? status(context) : install(context);
    case "status":
      return status(context);
    case "install":
      return install(context);
    case "uninstall":
      return uninstall(context);
    case "vault":
      switch (parsed.subcommand) {
        case "list":
          return vaultList(context);
        case "add":
          return vaultAdd(context);
        default:
          return vaultRemove(context);
      }
    default:
      return 2;
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  say(`error: ${error.message}`);
  process.exitCode = 1;
}
