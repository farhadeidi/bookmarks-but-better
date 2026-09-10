#!/usr/bin/env node
// `npx bookmarks-but-better`: the Daemon Manager (ADR-0006).
//
// Six verbs — `status`, `install`, `uninstall`, `vault list|add|remove` — and
// nothing that reads or changes a bookmark. Run with no command it is a menu:
// it installs when nothing is installed, and otherwise shows the status and
// offers what can be done about it. Every command asks for what it was not
// given, and `--yes` answers every question with its default.
//
// Everything it does is one of two things: run the daemon binary's own
// non-interactive commands and read their `--json` answers, or run the
// official installer for this platform, fetched from the GitHub Release and
// verified against its published SHA-256. The questions live here; the daemon
// asks none.
//
// Every decision is in ../lib, which is pure and tested. This file is the I/O.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import * as p from "@clack/prompts";

import { USAGE, installerFlags, parseArgs } from "../lib/cli.mjs";
import * as daemon from "../lib/daemon.mjs";
import { configPath, contractHome, expandHome, installLayout } from "../lib/layout.mjs";
import { Cancelled, createPrompter } from "../lib/prompt.mjs";
import {
  DEFAULT_GITHUB_BASE,
  checksumAssetName,
  commandFor,
  installerAssetName,
  parseChecksumSidecar,
  releaseAssetUrl,
  releaseTagFor,
} from "../lib/release.mjs";
import { assess, render, toJson } from "../lib/status.mjs";

const GITHUB_BASE = process.env.BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE || DEFAULT_GITHUB_BASE;
const HOME = homedir();
// The file that makes a directory a vault; the daemon writes it on `init`.
const VAULT_MARKER = ".bookmarks-but-better-folder.md";
const VAULT_ID = /^[a-z0-9-]{1,64}$/;

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const TOOL_VERSION = packageJson.version;

const out = (text) => process.stdout.write(`${text}\n`);
const home = (value) => contractHome(value, HOME);
const tail = (text, lines = 12) => text.trim().split("\n").slice(-lines).join("\n");

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

/**
 * Runs one of the daemon binary's commands under a spinner and logs what it
 * said. Returns whether it succeeded.
 */
async function step(title, binary, args) {
  const spin = p.spinner();
  spin.start(title);
  const result = await daemon.runQuiet(binary, args);
  if (!result.ok) {
    spin.stop(title, 1);
    p.log.error(tail(`${result.stdout}\n${result.stderr}`));
    return false;
  }
  spin.stop(title);
  const said = result.stdout.trim();
  if (said) p.log.message(said);
  return true;
}

/** Fetches, verifies and runs this platform's installer with `flags`. */
async function runInstaller(flags) {
  const tag = releaseTagFor(flags);
  const assetName = installerAssetName(process.platform);
  const installerUrl = releaseAssetUrl({ name: assetName, tag, base: GITHUB_BASE });
  const checksumUrl = releaseAssetUrl({ name: checksumAssetName(assetName), tag, base: GITHUB_BASE });

  const scratch = await mkdtemp(path.join(tmpdir(), "bookmarks-but-better-"));
  const scriptPath = path.join(scratch, assetName);
  const spin = p.spinner();
  try {
    // Resolved before anything is downloaded: a flag with no equivalent on
    // this platform is a refusal, not something to discover mid-install.
    const invocation = commandFor({ platform: process.platform, scriptPath, forwarded: flags });

    spin.start(`Fetching ${assetName} from the ${tag ?? "latest"} release`);
    const [installer, sidecar] = await Promise.all([download(installerUrl), download(checksumUrl)]);
    const expected = parseChecksumSidecar(sidecar.toString("utf8"));
    const actual = createHash("sha256").update(installer).digest("hex");
    if (expected !== actual) {
      spin.stop("The installer did not match its published checksum", 1);
      fail(
        `checksum verification failed for ${assetName} (expected ${expected}, got ${actual}); refusing to run a corrupted or tampered installer`,
      );
    }
    await writeFile(scriptPath, installer, { mode: 0o700 });
    spin.message("Installing the daemon and its background service");

    const result = await daemon.runQuiet(invocation.command, invocation.args, {
      env: { ...process.env, BOOKMARKS_BUT_BETTER_INSTALL_GITHUB_BASE: GITHUB_BASE },
    });
    if (!result.ok) {
      spin.stop("The installer failed", 1);
      p.log.error(tail(`${result.stdout}\n${result.stderr}`, 20));
      fail(`the installer stopped with exit code ${result.code}`);
    }
    spin.stop("Daemon installed");
    // The one thing worth repeating from the installer's own report.
    const notes = result.stderr.split("\n").filter((line) => /^(note:|  export PATH)/.test(line));
    if (notes.length > 0) p.log.warn(notes.join("\n"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Reads the machine into a report, waiting a moment for a daemon that just started. */
async function gather(layout, { settle = false } = {}) {
  const report = await daemon.gather({ layout, toolVersion: TOOL_VERSION });
  if (settle && !report.health && report.service?.state === "running") {
    try {
      report.health = await daemon.waitForHealth(report.origin);
      report.healthError = null;
    } catch (error) {
      report.healthError = error.message;
    }
  }
  return report;
}

/** Prints the report; a bad state is an answer, not a failure. */
async function status({ layout, options }) {
  const report = await gather(layout);
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
    p.log.info(
      installed
        ? "The daemon is installed but no vault is configured yet."
        : "The daemon is not installed yet. A vault is a folder of Markdown files; one is created if the folder is empty or missing.",
    );
    vault = expandHome(
      await prompter.ask("Where should your bookmarks live?", path.join(HOME, "Bookmarks"), {
        validate: (value) =>
          value && !path.isAbsolute(expandHome(value, HOME)) ? "Use an absolute path, or ~/…" : undefined,
      }),
      HOME,
    );
  }
  if (vault) vault = path.resolve(vault);

  const plan = [
    installed ? `update the daemon to ${TOOL_VERSION}` : `install the daemon ${TOOL_VERSION} under ${home(layout.installRoot)}`,
    vault ? `use ${home(vault)} as the vault` : null,
    "install and start the background service",
  ].filter(Boolean);
  if (!(await prompter.confirm(`This will ${plan.join(", ")}. Continue?`, { fallback: true }))) {
    throw new Cancelled();
  }

  await runInstaller(installerFlags({ options, toolVersion: TOOL_VERSION, vault }));
  const report = await gather(layout, { settle: true });
  p.note(render(report, { homedir: HOME }), "Status");
  return assess(report).ok ? 0 : 1;
}

/**
 * Removes the service and the daemon. Vault directories are never touched,
 * and the configuration file is kept unless asked otherwise — it is one small
 * file, and a later install picks it up again.
 */
async function uninstall({ layout, options, prompter }) {
  const fallbackConfig = configPath({ platform: process.platform, env: process.env, homedir: HOME });

  if (!existsSync(layout.binary)) {
    p.log.info(`Nothing is installed under ${home(layout.installRoot)}.`);
    if (options.purgeConfig && existsSync(fallbackConfig)) {
      await rm(fallbackConfig, { force: true });
      p.log.success(`Removed ${home(fallbackConfig)}`);
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
  if (!go) throw new Cancelled();

  await step("Removing the background service", layout.binary, ["service", "uninstall"]);
  await rm(layout.installRoot, { recursive: true, force: true });
  if (layout.binLink) await rm(layout.binLink, { force: true });
  if (process.platform === "win32") await daemon.removeFromUserPath(layout.current);
  p.log.success(`Removed ${home(layout.installRoot)}${layout.binLink ? ` and ${home(layout.binLink)}` : ""}`);

  let purge = Boolean(options.purgeConfig);
  if (!purge && existsSync(config)) {
    purge = await prompter.confirm(`Also remove the configuration at ${home(config)}?`, {
      fallback: false,
      whenYes: false,
    });
  }
  if (purge) {
    await rm(config, { force: true });
    p.log.success(`Removed ${home(config)}`);
  } else if (existsSync(config)) {
    p.log.info(`Kept ${home(config)}; a later install picks it up again.`);
  }
  for (const vault of vaults) {
    p.log.info(`Untouched: ${vault.id}  ${home(vault.path)}`);
  }
  return 0;
}

/** Reinstalls the service from the registry — which restarts it — when one is installed. */
async function applyToService({ layout, prompter, why }) {
  const installed = await daemon.serviceIsInstalled(layout.binary);
  if (!installed) {
    p.log.info("No background service is installed; `install` sets one up.");
    return 0;
  }
  const go = await prompter.confirm(`Restart the background service ${why}?`, { fallback: true });
  if (!go) {
    p.log.warn("The running daemon keeps its current vaults until the service is reinstalled.");
    return 0;
  }

  const spin = p.spinner();
  spin.start("Restarting the background service");
  const result = await daemon.runQuiet(layout.binary, [
    "service",
    "install",
    "--from-config",
    "--ui-dir",
    layout.uiDir,
  ]);
  if (!result.ok) {
    spin.stop("The service could not be reinstalled", 1);
    p.log.error(tail(`${result.stdout}\n${result.stderr}`));
    return result.code;
  }

  const { value: registry } = await daemon.readRegistry(layout.binary);
  const { value: service } = await daemon.readService(layout.binary);
  const origin = daemon.originOf({ registry, service });
  try {
    const health = await daemon.waitForHealth(origin);
    spin.stop(`Service restarted; hosting ${health.vaults.map((vault) => vault.id).join(", ")}`);
  } catch (error) {
    spin.stop(`Service restarted, but it has not answered at ${origin} yet (${error.message})`, 2);
  }
  return 0;
}

function vaultList({ layout, options }) {
  requireInstalled(layout);
  return daemon.runVisible(layout.binary, ["vault", "list", ...(options.json ? ["--json"] : [])]);
}

async function vaultAdd({ layout, args, prompter }) {
  requireInstalled(layout);
  let [id, given] = args;
  if (!id) {
    id = await prompter.ask("An id for the vault (lowercase letters, digits, hyphens)", "", {
      validate: (value) => (VAULT_ID.test(value) ? undefined : "1–64 lowercase letters, digits and hyphens"),
    });
    if (!VAULT_ID.test(id)) fail("vault add needs an id: 1–64 lowercase letters, digits and hyphens");
    given = await prompter.ask("Where is (or should be) the folder?", path.join(HOME, "Bookmarks", id), {
      validate: (value) =>
        value && !path.isAbsolute(expandHome(value, HOME)) ? "Use an absolute path, or ~/…" : undefined,
    });
  }
  const directory = path.resolve(expandHome(given, HOME));

  // A directory that is not a vault yet is made one only on a yes: `--init`
  // is what turns a typo into a vault in the wrong place, so it is never
  // implied.
  let init = false;
  if (!existsSync(path.join(directory, VAULT_MARKER))) {
    init = await prompter.confirm(`${home(directory)} is not a vault yet. Create one there?`, {
      fallback: true,
    });
    if (!init) throw new Cancelled();
  }

  const ok = await step(`Adding \`${id}\` at ${home(directory)}`, layout.binary, [
    "vault",
    "add",
    id,
    directory,
    ...(init ? ["--init"] : []),
  ]);
  if (!ok) return 1;
  return applyToService({ layout, prompter, why: `so it hosts \`${id}\`` });
}

async function vaultRemove({ layout, args, prompter }) {
  requireInstalled(layout);
  let [id] = args;
  if (!id) {
    const { value: registry } = await daemon.readRegistry(layout.binary);
    const vaults = registry?.vaults ?? [];
    if (vaults.length === 0) {
      p.log.info("No vault is configured.");
      return 0;
    }
    id = await prompter.select(
      "Which vault should leave the configuration? Its directory stays.",
      vaults.map((vault) => ({ value: vault.id, label: vault.id, hint: home(vault.path) })),
    );
  }

  const go = await prompter.confirm(`Remove \`${id}\` from the configuration? Its directory stays.`, {
    fallback: false,
    whenYes: true,
  });
  if (!go) throw new Cancelled();

  const ok = await step(`Removing \`${id}\` from the configuration`, layout.binary, ["vault", "remove", id]);
  if (!ok) return 1;

  if ((await daemon.registryHasVaults(layout.binary)) === false) {
    if (await daemon.serviceIsInstalled(layout.binary)) {
      // A service with nothing to serve would fail at every login; a
      // definition still naming the removed vault would serve it anyway.
      p.log.info("No vault is left to serve, so the background service is removed too; `vault add` brings it back.");
      return (await step("Removing the background service", layout.binary, ["service", "uninstall"])) ? 0 : 1;
    }
    return 0;
  }
  return applyToService({ layout, prompter, why: `so it stops hosting \`${id}\`` });
}

/**
 * No command: the menu. Nothing installed means the first run; otherwise the
 * status, then whatever can be done about it — each problem's fix first.
 */
async function menu(context) {
  const { layout, prompter } = context;
  if (!existsSync(layout.binary)) {
    return install(context);
  }

  const report = await gather(layout);
  p.note(render(report, { homedir: HOME }), "Status");
  const { problems } = assess(report);
  const vaults = report.registry?.vaults ?? [];

  const options = [];
  problems.forEach((problem, index) => {
    options.push({ value: `fix:${index}`, label: `Fix: ${problem.summary}`, hint: problem.fix });
  });
  options.push({ value: "add", label: "Add a vault", hint: "and restart the service so it hosts it" });
  if (vaults.length > 0) {
    options.push({ value: "remove", label: "Remove a vault", hint: "its directory stays" });
  }
  options.push({
    value: "install",
    label: report.binary.version === TOOL_VERSION ? "Reinstall the daemon and its service" : `Update the daemon to ${TOOL_VERSION}`,
    hint: "keeps every vault",
  });
  options.push({ value: "uninstall", label: "Uninstall the daemon", hint: "vaults stay" });
  options.push({ value: "exit", label: "Nothing, exit" });

  const action = await prompter.select("What do you want to do?", options);
  if (action === "exit") return 0;
  if (action === "add") return vaultAdd({ ...context, args: [] });
  if (action === "remove") return vaultRemove({ ...context, args: [] });
  if (action === "install") return install(context);
  if (action === "uninstall") return uninstall(context);

  const problem = problems[Number(action.slice("fix:".length))];
  switch (problem.action.kind) {
    case "install":
      return install(context);
    case "vault-remove":
      return vaultRemove({ ...context, args: [problem.action.id] });
    default:
      p.log.info(problem.fix);
      return 0;
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) process.stderr.write(`error: ${error}\n`);
    process.stderr.write(`\n${USAGE}\n`);
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

  // The plain, scriptable readings print without decoration.
  if (parsed.command === "status") return status(context);
  if (parsed.command === "vault" && parsed.subcommand === "list") return vaultList(context);

  p.intro(`Bookmarks But Better ${TOOL_VERSION}`);
  try {
    let code;
    switch (parsed.command) {
      case null:
        code = await menu(context);
        break;
      case "install":
        code = await install(context);
        break;
      case "uninstall":
        code = await uninstall(context);
        break;
      default:
        code = parsed.subcommand === "add" ? await vaultAdd(context) : await vaultRemove(context);
    }
    p.outro(code === 0 ? "Done." : "Stopped; see above.");
    return code;
  } catch (error) {
    if (error instanceof Cancelled) {
      p.cancel("Nothing was changed.");
      return 1;
    }
    p.log.error(error.message);
    p.outro("Stopped.");
    return 1;
  }
}

process.exitCode = await main();
