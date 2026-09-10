// The status report: what is true of this machine, read into one shape by
// `daemon.mjs`, and here turned into problems that each name the one command
// that fixes them. No I/O, so every situation is a fixture in
// `test/status.test.mjs`.

import { contractHome } from "./layout.mjs";

const DEFAULT_PORT = 52222;
const DEFAULT_BIND = "127.0.0.1";

const INSTALL = "npx bookmarks-but-better install";

/** `http://host:port`, with an IPv6 host in brackets. */
export function formatOrigin(bind = DEFAULT_BIND, port = DEFAULT_PORT) {
  const host = bind.includes(":") ? `[${bind}]` : bind;
  return `http://${host}:${port}`;
}

/** The version out of `bookmarks-but-better --version`'s one line. */
export function parseVersionOutput(text) {
  const match = String(text)
    .trim()
    .match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

/** An empty report: the shape `daemon.mjs` fills in. */
export function emptyReport({ toolVersion, binaryPath }) {
  return {
    tool: { version: toolVersion },
    binary: { installed: false, path: binaryPath, version: null },
    registry: null,
    registryError: null,
    service: null,
    serviceError: null,
    origin: null,
    health: null,
    healthError: null,
  };
}

const ids = (list) => new Set((list ?? []).map((entry) => entry.id));
const sameSet = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Every problem in `report`, each with the command that fixes it — `fix` is
 * that command as text, `action` the same thing the interactive menu can
 * perform: `{ kind: "install" }`, `{ kind: "vault-remove", id }`, or
 * `{ kind: "manual" }` for something only a person can do. Order is the order
 * a person should read them in: nothing later is worth fixing while something
 * earlier is wrong.
 */
export function assess(report) {
  const problems = [];
  const add = (summary, fix, action = { kind: "install" }) => problems.push({ summary, fix, action });

  if (!report.binary.installed) {
    add("the daemon is not installed", INSTALL);
    return { ok: false, problems };
  }
  if (report.binary.version && report.binary.version !== report.tool.version) {
    add(
      `the installed daemon is ${report.binary.version}; this tool is ${report.tool.version}`,
      INSTALL,
    );
  }

  const registry = report.registry;
  if (!registry) {
    add(
      `the configuration could not be read${report.registryError ? `: ${report.registryError}` : ""}`,
      INSTALL,
    );
  } else if (registry.vaults.length === 0) {
    add("no vault is configured", INSTALL);
  } else {
    for (const vault of registry.vaults) {
      if (vault.state === "directory missing") {
        add(
          `vault \`${vault.id}\`: ${vault.path} does not exist`,
          `restore that folder, or: npx bookmarks-but-better vault remove ${vault.id}`,
          { kind: "vault-remove", id: vault.id },
        );
      } else if (vault.state === "not a directory") {
        add(
          `vault \`${vault.id}\`: ${vault.path} is not a directory`,
          `npx bookmarks-but-better vault remove ${vault.id}`,
          { kind: "vault-remove", id: vault.id },
        );
      } else if (vault.state === "not initialized") {
        add(
          `vault \`${vault.id}\`: ${vault.path} is not a vault yet`,
          `npx bookmarks-but-better vault remove ${vault.id}, then vault add ${vault.id} ${vault.path}`,
          { kind: "vault-remove", id: vault.id },
        );
      }
    }
  }

  const service = report.service;
  if (!service) {
    add(
      `the background service could not be checked${report.serviceError ? `: ${report.serviceError}` : ""}`,
      INSTALL,
    );
  } else if (service.state === "not-installed") {
    add("the background service is not installed", INSTALL);
  } else if (service.state === "stopped") {
    add("the background service is installed but not running", INSTALL);
  } else if (registry && registry.vaults.length > 0 && !sameSet(ids(registry.vaults), ids(service.vaults))) {
    add("the service was installed for a different set of vaults than is configured", INSTALL);
  }

  const health = report.health;
  const serviceInstalled = service && service.state !== "not-installed";
  if (!health) {
    if (serviceInstalled && service.state !== "stopped") {
      add(
        `the daemon is not answering at ${report.origin}${report.healthError ? ` (${report.healthError})` : ""}`,
        `${INSTALL} (which restarts it)`,
      );
    }
  } else {
    if (report.binary.version && health.version !== report.binary.version) {
      add(
        `the running daemon is ${health.version}, the installed one ${report.binary.version}`,
        `${INSTALL} (which restarts it)`,
      );
    }
    if (registry) {
      const hosted = ids(health.vaults);
      for (const vault of registry.vaults) {
        if (!hosted.has(vault.id)) {
          add(
            `\`${vault.id}\` is configured but the running daemon does not host it`,
            `${INSTALL} (which restarts it)`,
          );
        }
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/** The report as lines for a terminal. */
export function render(report, { homedir = "" } = {}) {
  const home = (value) => contractHome(value, homedir);
  const lines = [];
  const row = (label, value) => lines.push(`${label.padEnd(10)} ${value}`);

  row("tool", report.tool.version);

  if (!report.binary.installed) {
    row("daemon", "not installed");
  } else {
    row("daemon", `${report.binary.version ?? "unknown version"}  ${home(report.binary.path)}`);
  }

  if (report.binary.installed) {
    const service = report.service;
    if (!service) {
      row("service", `could not be checked${report.serviceError ? `: ${report.serviceError}` : ""}`);
    } else if (service.state === "not-installed") {
      row("service", "not installed");
    } else {
      const state =
        service.state === "installed-unsupervised"
          ? "installed; starts at your next login"
          : service.state;
      row("service", `${state} (${service.kind})${service.port ? `, port ${service.port}` : ""}`);
    }

    if (report.health) {
      const clients = report.health.clients ?? 0;
      const who =
        clients === 0
          ? "no browser connected"
          : `${clients} browser connection${clients === 1 ? "" : "s"}`;
      row("running", `yes, ${report.health.version} at ${report.origin}; ${who}`);
    } else {
      row("running", `no${report.healthError ? ` (${report.origin}: ${report.healthError})` : ""}`);
    }

    const registry = report.registry;
    if (!registry) {
      row("vaults", `could not be read${report.registryError ? `: ${report.registryError}` : ""}`);
    } else if (registry.vaults.length === 0) {
      row("vaults", "none configured");
    } else {
      const hosted = ids(report.health?.vaults);
      const width = Math.max(...registry.vaults.map((vault) => vault.id.length));
      lines.push("vaults");
      for (const vault of registry.vaults) {
        const state = hosted.has(vault.id)
          ? "hosted"
          : vault.state === "ok" || vault.state === "served now"
            ? "configured, not hosted"
            : vault.state;
        lines.push(`  ${vault.id.padEnd(width)}  ${home(vault.path)}  (${state})`);
      }
    }
  }

  const { ok, problems } = assess(report);
  lines.push("");
  if (ok) {
    lines.push("everything is in place");
    if (report.health && (report.health.clients ?? 0) === 0) {
      lines.push(`connect a browser: Settings → Sources → Connect, address ${report.origin}`);
    }
  } else {
    lines.push(problems.length === 1 ? "one thing to fix:" : `${problems.length} things to fix:`);
    for (const problem of problems) {
      lines.push(`  - ${problem.summary}`);
      lines.push(`    ${problem.fix}`);
    }
  }
  return lines.join("\n");
}

/** The report plus its assessment, for `--json`. */
export function toJson(report) {
  return { ...report, assessment: assess(report) };
}
