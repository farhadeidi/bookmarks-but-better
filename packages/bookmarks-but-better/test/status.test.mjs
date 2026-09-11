// Every state a machine can be in, and the one command each problem names.

import assert from "node:assert/strict";
import test from "node:test";

import { assess, compareBase, emptyReport, formatOrigin, parseVersionOutput, render } from "../lib/status.mjs";

const INSTALL = "npx bookmarks-but-better install";

function healthy(overrides = {}) {
  const report = emptyReport({
    toolVersion: "1.0.0",
    daemonVersion: "4.1.0",
    binaryPath: "/home/me/.local/share/bookmarks-but-better/current/bookmarks-but-better",
  });
  report.binary.installed = true;
  report.binary.version = "4.1.0";
  report.registry = {
    configuration: "/home/me/.config/bookmarks-but-better/config.toml",
    bind: "127.0.0.1",
    port: 52222,
    uiDir: null,
    vaults: [{ id: "default", path: "/home/me/Bookmarks", state: "served now" }],
  };
  report.service = {
    kind: "LaunchAgent",
    definition: "/home/me/Library/LaunchAgents/com.farhadeidi.bookmarks.plist",
    state: "running",
    vaults: [{ id: "default", path: "/home/me/Bookmarks" }],
    port: 52222,
  };
  report.origin = "http://127.0.0.1:52222";
  report.health = { status: "ok", version: "4.1.0", clients: 1, vaults: [{ id: "default", name: "Bookmarks" }] };
  return { ...report, ...overrides };
}

test("a healthy machine has nothing to fix", () => {
  const assessment = assess(healthy());
  assert.equal(assessment.ok, true);
  assert.deepEqual(assessment.problems, []);
  const text = render(healthy(), { homedir: "/home/me" });
  assert.ok(text.includes("everything is in place"), text);
  assert.ok(text.includes("~/Bookmarks"), "paths under home are shown as ~");
  assert.ok(text.includes("1 browser connection"), text);
  assert.ok(text.includes("(hosted)"), text);
});

test("nothing installed is exactly one problem, and it says install", () => {
  const report = emptyReport({ toolVersion: "1.0.0", daemonVersion: "4.1.0", binaryPath: "/x/bookmarks-but-better" });
  const { ok, problems } = assess(report);
  assert.equal(ok, false);
  assert.deepEqual(problems, [
    { summary: "the daemon is not installed", fix: INSTALL, action: { kind: "install" } },
  ]);
  const text = render(report);
  assert.ok(text.includes("not installed"), text);
  assert.ok(text.includes(INSTALL), text);
  // Nothing else is worth reporting until that is fixed.
  assert.ok(!text.includes("service"), text);
});

test("a daemon older than the one this tool installs is an update, not an error", () => {
  const report = healthy();
  report.binary.version = "4.0.0";
  report.health.version = "4.0.0";
  const { problems } = assess(report);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].summary.includes("4.0.0"));
  assert.ok(problems[0].summary.includes("4.1.0"));
  assert.equal(problems[0].fix, INSTALL);
});

test("a prerelease of the same daemon line is the same line", () => {
  const report = healthy();
  report.binary.version = "4.1.0-beta.2";
  report.health.version = "4.1.0-beta.2";
  assert.equal(assess(report).ok, true);
});

test("a daemon newer than this tool knows means the tool is out of date, not the daemon", () => {
  const report = healthy();
  report.binary.version = "4.2.0";
  report.health.version = "4.2.0";
  const { problems } = assess(report);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].summary.includes("newer"));
  assert.equal(problems[0].fix, "npx bookmarks-but-better@latest");
  // Reinstalling would downgrade, so the menu must not offer it as the fix.
  assert.deepEqual(problems[0].action, { kind: "manual" });
});

test("version lines compare on major.minor.patch only", () => {
  assert.ok(compareBase("4.0.0", "4.1.0") < 0);
  assert.equal(compareBase("4.1.0-beta.2", "4.1.0"), 0);
  assert.ok(compareBase("4.10.0", "4.9.9") > 0);
  assert.ok(compareBase("5.0.0", "4.99.99") > 0);
  assert.equal(compareBase(null, "4.1.0"), 0, "an unknown version is not a problem here; the report says unknown");
});

test("no vault configured points at install, which asks for one", () => {
  const report = healthy();
  report.registry.vaults = [];
  report.service.state = "not-installed";
  report.service.vaults = [];
  report.health = null;
  const { problems } = assess(report);
  assert.deepEqual(
    problems.map((problem) => problem.summary),
    ["no vault is configured", "the background service is not installed"],
  );
  assert.ok(problems.every((problem) => problem.fix === INSTALL));
});

test("a vault whose directory is gone names the vault and the way out", () => {
  const report = healthy();
  report.registry.vaults.push({ id: "old", path: "/home/me/Gone", state: "directory missing" });
  const { problems } = assess(report);
  const missing = problems.find((problem) => problem.summary.includes("`old`"));
  assert.ok(missing, JSON.stringify(problems));
  assert.ok(missing.fix.includes("vault remove old"));
  // The menu can perform that fix without the user typing the id.
  assert.deepEqual(missing.action, { kind: "vault-remove", id: "old" });
  // The daemon does not host it either; that is the same root cause and is
  // still reported, because the fix differs (restart versus remove).
  assert.ok(problems.some((problem) => problem.summary.includes("does not host")));
});

test("configured but not hosted is a restart, which install performs", () => {
  const report = healthy();
  report.registry.vaults.push({ id: "work", path: "/home/me/Work", state: "ok" });
  report.service.vaults.push({ id: "work", path: "/home/me/Work" });
  const { problems } = assess(report);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].summary.includes("`work` is configured but the running daemon does not host it"));
  assert.ok(problems[0].fix.startsWith(INSTALL));
  const text = render(report, { homedir: "/home/me" });
  assert.ok(text.includes("configured, not hosted"), text);
});

test("a service installed for other vaults than the registry lists is caught", () => {
  const report = healthy();
  report.registry.vaults.push({ id: "work", path: "/home/me/Work", state: "ok" });
  const { problems } = assess(report);
  assert.ok(problems.some((problem) => problem.summary.includes("different set of vaults")));
});

test("a running service that does not answer is reported with its address", () => {
  const report = healthy();
  report.health = null;
  report.healthError = "ECONNREFUSED";
  const { problems } = assess(report);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].summary.includes("http://127.0.0.1:52222"));
  assert.ok(problems[0].summary.includes("ECONNREFUSED"));
});

test("a stopped service is the problem; its silence is not a second one", () => {
  const report = healthy();
  report.service.state = "stopped";
  report.health = null;
  const { problems } = assess(report);
  assert.deepEqual(
    problems.map((problem) => problem.summary),
    ["the background service is installed but not running"],
  );
});

test("a browser that is not connected is advice, not a problem", () => {
  const report = healthy();
  report.health.clients = 0;
  assert.equal(assess(report).ok, true);
  const text = render(report);
  assert.ok(text.includes("no browser connected"), text);
  assert.ok(text.includes("Settings → Sources → Connect"), text);
});

test("the daemon's address is built from bind and port, with IPv6 in brackets", () => {
  assert.equal(formatOrigin(), "http://127.0.0.1:52222");
  assert.equal(formatOrigin("::1", 4000), "http://[::1]:4000");
});

test("the version is read out of the binary's one-line answer", () => {
  assert.equal(parseVersionOutput("bookmarks-but-better 4.1.0\n"), "4.1.0");
  assert.equal(parseVersionOutput("bookmarks-but-better 4.1.0-beta.1 (smoke test)"), "4.1.0-beta.1");
  assert.equal(parseVersionOutput("garbage"), null);
});
