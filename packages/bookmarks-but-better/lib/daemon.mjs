// Everything that touches the machine: running the daemon binary's own
// commands, reading their `--json` answers, and asking a running daemon how it
// is. The decisions about what those answers mean live in `status.mjs`.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { emptyReport, formatOrigin, parseVersionOutput } from "./status.mjs";

const execFileAsync = promisify(execFile);

/** Runs `binary args…` and returns what it printed, never throwing. */
export async function runQuiet(binary, args, { env = process.env } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(binary, args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env,
    });
    return { ok: true, code: 0, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error.message ?? error),
    };
  }
}

/** Runs `command args…` with the terminal attached, resolving to its exit code. */
export function runVisible(command, args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** Runs a `--json` command and parses its answer. */
async function readJson(binary, args) {
  const result = await runQuiet(binary, args);
  if (!result.ok) {
    return { value: null, error: result.stderr.trim() || `exit code ${result.code}` };
  }
  try {
    return { value: JSON.parse(result.stdout), error: null };
  } catch {
    return { value: null, error: `unreadable output from \`${args.join(" ")}\`` };
  }
}

async function readVersion(binary) {
  const result = await runQuiet(binary, ["--version"]);
  return result.ok ? parseVersionOutput(result.stdout) : null;
}

export async function readRegistry(binary) {
  return readJson(binary, ["vault", "list", "--json"]);
}

export async function readService(binary) {
  return readJson(binary, ["service", "status", "--json"]);
}

/** `GET /api/v1/health`, with a short timeout: loopback answers at once or not at all. */
async function fetchHealth(origin, { timeoutMs = 2000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}/api/v1/health`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    throw new Error(error.name === "AbortError" ? "timed out" : error.cause?.code ?? error.message);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Health, retried while a just-started daemon opens its vaults. */
export async function waitForHealth(origin, { attempts = 40, delayMs = 250 } = {}) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchHealth(origin);
    } catch (error) {
      last = error;
      await sleep(delayMs);
    }
  }
  throw last ?? new Error("no answer");
}

/** The daemon's address, from the configuration, else the service, else the defaults. */
export function originOf({ registry, service }) {
  return formatOrigin(registry?.bind ?? undefined, registry?.port ?? service?.port ?? undefined);
}

/** Reads everything `status` reports into one shape. */
export async function gather({ layout, toolVersion }) {
  const report = emptyReport({ toolVersion, binaryPath: layout.binary });
  if (!existsSync(layout.binary)) return report;

  report.binary.installed = true;
  report.binary.version = await readVersion(layout.binary);

  const registry = await readRegistry(layout.binary);
  report.registry = registry.value;
  report.registryError = registry.error;

  const service = await readService(layout.binary);
  report.service = service.value;
  report.serviceError = service.error;

  report.origin = originOf({ registry: report.registry, service: report.service });
  try {
    report.health = await fetchHealth(report.origin);
  } catch (error) {
    report.healthError = error.message;
  }
  return report;
}

/** Whether the registry lists any vault; `null` when it could not be read. */
export async function registryHasVaults(binary) {
  const { value } = await readRegistry(binary);
  return value ? value.vaults.length > 0 : null;
}

/** Whether a service definition is installed; `null` when it could not be asked. */
export async function serviceIsInstalled(binary) {
  const { value } = await readService(binary);
  return value ? value.state !== "not-installed" : null;
}

/**
 * Takes `entry` off the user's PATH on Windows, where install.ps1 put it. A
 * PowerShell one-liner because the user PATH lives in the registry, and
 * `[Environment]::SetEnvironmentVariable` is the supported way to write it.
 */
export async function removeFromUserPath(entry) {
  const script = [
    "$entries = [Environment]::GetEnvironmentVariable('Path', 'User') -split ';'",
    `$kept = $entries | Where-Object { $_ -and $_ -ne '${entry.replace(/'/g, "''")}' }`,
    "[Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')",
  ].join("; ");
  const result = await runQuiet("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return result.ok;
}
