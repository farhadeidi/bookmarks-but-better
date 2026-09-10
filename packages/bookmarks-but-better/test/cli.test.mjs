// Every way `npx bookmarks-but-better …` can be typed, and what each means.

import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMANDS,
  SUPPORTED_OPTIONS,
  USAGE,
  VAULT_SUBCOMMANDS,
  installerFlags,
  parseArgs,
} from "../lib/cli.mjs";

test("no command at all is a valid ask: install or status, decided later", () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.command, null);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.help, false);
});

test("every command and vault subcommand is documented in --help", () => {
  for (const command of COMMANDS) {
    assert.ok(USAGE.includes(`  ${command}`), `${command} should be in USAGE`);
  }
  for (const subcommand of VAULT_SUBCOMMANDS) {
    assert.ok(USAGE.includes(`vault ${subcommand}`), `vault ${subcommand} should be in USAGE`);
  }
  for (const option of SUPPORTED_OPTIONS) {
    assert.ok(USAGE.includes(option), `${option} should be in USAGE`);
  }
});

test("vault subcommands carry exactly the arguments they need", () => {
  assert.deepEqual(parseArgs(["vault", "list"]).errors, []);
  const add = parseArgs(["vault", "add", "work", "~/Work"]);
  assert.deepEqual(add.errors, []);
  assert.equal(add.subcommand, "add");
  assert.deepEqual(add.args, ["work", "~/Work"]);
  assert.deepEqual(parseArgs(["vault", "remove", "work"]).args, ["work"]);

  assert.ok(parseArgs(["vault"]).errors[0].includes("vault needs one of"));
  assert.ok(parseArgs(["vault", "add", "work"]).errors[0].includes("an id and a path"));
  assert.ok(parseArgs(["vault", "remove"]).errors[0].includes("exactly an id"));
  assert.ok(parseArgs(["vault", "list", "extra"]).errors[0].includes("takes no arguments"));
  assert.ok(parseArgs(["vault", "rename", "a", "b"]).errors[0].includes("vault needs one of"));
});

test("a command that takes no arguments refuses them", () => {
  assert.deepEqual(parseArgs(["status", "please"]).errors, ["status takes no arguments"]);
  assert.deepEqual(parseArgs(["bookmark", "add"]).errors, ["unknown command: bookmark"]);
});

test("options parse wherever they appear, with their values", () => {
  const parsed = parseArgs(["--yes", "install", "--vault", "~/Bookmarks", "--beta", "--install-dir", "/opt/bbb"]);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.command, "install");
  assert.deepEqual(parsed.options, {
    yes: true,
    vault: "~/Bookmarks",
    beta: true,
    installDir: "/opt/bbb",
  });
  assert.equal(parseArgs(["-y", "uninstall", "--purge-config"]).options.purgeConfig, true);
  assert.equal(parseArgs(["status", "--json"]).options.json, true);
});

test("an unknown option and a value-taking option without a value are both refused", () => {
  assert.deepEqual(parseArgs(["--make-coffee"]).errors, ["unrecognized option: --make-coffee"]);
  assert.deepEqual(parseArgs(["install", "--version"]).errors, ["--version needs an argument"]);
  // The next option is not swallowed as if it were the value.
  const parsed = parseArgs(["install", "--version", "--beta"]);
  assert.deepEqual(parsed.errors, ["--version needs an argument"]);
  assert.equal(parsed.options.beta, true);
  // Two mistakes are two messages, not one.
  assert.equal(parseArgs(["fly", "--fast"]).errors.length, 2);
});

test("-h and --help ask for help without complaint", () => {
  for (const flag of ["-h", "--help"]) {
    const parsed = parseArgs([flag]);
    assert.equal(parsed.help, true);
    assert.deepEqual(parsed.errors, []);
  }
});

test("install pins the daemon to this tool's own version unless told otherwise", () => {
  assert.deepEqual(installerFlags({ options: {}, toolVersion: "4.1.0" }), ["--version", "v4.1.0"]);
  assert.deepEqual(installerFlags({ options: { beta: true }, toolVersion: "4.1.0" }), ["--beta"]);
  assert.deepEqual(installerFlags({ options: { version: "v4.0.0", beta: true }, toolVersion: "4.1.0" }), [
    "--version",
    "v4.0.0",
  ]);
});

test("install forwards the directories and the first vault", () => {
  assert.deepEqual(
    installerFlags({
      options: { installDir: "/opt/bbb", binDir: "/opt/bin" },
      toolVersion: "4.1.0",
      vault: "/home/me/Bookmarks",
    }),
    ["--version", "v4.1.0", "--install-dir", "/opt/bbb", "--bin-dir", "/opt/bin", "--vault", "/home/me/Bookmarks"],
  );
});
