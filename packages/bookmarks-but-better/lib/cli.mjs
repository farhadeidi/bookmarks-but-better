// What `npx bookmarks-but-better …` was asked to do, read out of `argv` with no
// I/O — which is what lets `test/cli.test.mjs` cover every command, option and
// mistake without spawning anything.

export const COMMANDS = ["status", "install", "uninstall", "vault"];
export const VAULT_SUBCOMMANDS = ["list", "add", "remove"];

export const USAGE = `Usage: npx bookmarks-but-better [command] [options]

Installs and looks after the Bookmarks But Better daemon on this machine. Run
with no command, it is a menu: it installs the daemon when none is installed,
and otherwise shows the status and offers what can be done about it. Every
command asks for what it was not given; --yes answers with the defaults.

Commands:
  status                 What is installed, configured, running and connected,
                         and the one command that fixes anything that is not.
  install                Install or update the daemon, configure the first
                         vault, and install and start the background service.
                         Safe to run again: an update keeps every vault.
  uninstall              Stop and remove the service and the daemon. Vaults are
                         never touched; the configuration is kept unless
                         --purge-config says otherwise.
  vault list             The configured vaults and what is true of each.
  vault add [<id> <path>]
                         Configure another vault and restart the service.
  vault remove [<id>]    Drop a vault from the configuration (the directory
                         stays) and restart the service.

Options:
  -y, --yes              Never ask; take every default. For scripts.
  --json                 Machine-readable output (status, vault list).
  --vault <dir>          install: where the first vault lives. Asked when left
                         out; ~/Bookmarks with --yes.
  --beta                 install: the latest prerelease instead of this tool's
                         own version.
  --version <tag>        install: exactly this release, e.g. v4.1.0.
  --install-dir <dir>    install: where daemon versions are unpacked.
  --bin-dir <dir>        install: where the bookmarks-but-better symlink goes.
                         macOS and Linux only.
  --purge-config         uninstall: also remove the configuration file.
  -h, --help             Show this help.`;

const OPTIONS = new Map([
  ["-y", { key: "yes" }],
  ["--yes", { key: "yes" }],
  ["--json", { key: "json" }],
  ["--beta", { key: "beta" }],
  ["--purge-config", { key: "purgeConfig" }],
  ["--version", { key: "version", takesValue: true }],
  ["--install-dir", { key: "installDir", takesValue: true }],
  ["--bin-dir", { key: "binDir", takesValue: true }],
  ["--vault", { key: "vault", takesValue: true }],
]);

export const SUPPORTED_OPTIONS = [...OPTIONS.keys()];

/**
 * Splits `argv` into a command, its arguments and its options. Every mistake
 * is collected rather than thrown, so a user who made two gets told about
 * both; an unknown option or command is refused here rather than guessed at.
 */
export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  const errors = [];
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }
    if (!argument.startsWith("-")) {
      positionals.push(argument);
      continue;
    }
    const option = OPTIONS.get(argument);
    if (!option) {
      errors.push(`unrecognized option: ${argument}`);
      continue;
    }
    if (!option.takesValue) {
      options[option.key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) {
      errors.push(`${argument} needs an argument`);
      continue;
    }
    index += 1;
    options[option.key] = value;
  }

  const [command = null, ...rest] = positionals;
  let subcommand = null;
  let args = rest;

  if (command !== null && !COMMANDS.includes(command)) {
    errors.push(`unknown command: ${command}`);
  } else if (command === "vault") {
    subcommand = rest[0] ?? null;
    args = rest.slice(1);
    if (!VAULT_SUBCOMMANDS.includes(subcommand)) {
      errors.push("vault needs one of: list, add <id> <path>, remove <id>");
    } else if (subcommand === "add" && args.length !== 0 && args.length !== 2) {
      errors.push("vault add takes an id and a path, or nothing and asks for both");
    } else if (subcommand === "remove" && args.length > 1) {
      errors.push("vault remove takes one id, or nothing and offers a choice");
    } else if (subcommand === "list" && args.length !== 0) {
      errors.push("vault list takes no arguments");
    }
  } else if (command !== null && rest.length > 0) {
    errors.push(`${command} takes no arguments`);
  }

  return { command, subcommand, args, options, help, errors };
}

/**
 * The flags `install` hands the installer script. Left to itself the tool
 * installs its own version — the daemon it was written against, whose
 * `--json` output it reads — so the two never drift apart on one machine.
 * `--version` and `--beta` are the explicit ways to choose otherwise.
 */
export function installerFlags({ options, toolVersion, vault = null }) {
  const flags = [];
  if (options.version) {
    flags.push("--version", options.version);
  } else if (options.beta) {
    flags.push("--beta");
  } else {
    flags.push("--version", `v${toolVersion}`);
  }
  if (options.installDir) flags.push("--install-dir", options.installDir);
  if (options.binDir) flags.push("--bin-dir", options.binDir);
  if (vault) flags.push("--vault", vault);
  return flags;
}
