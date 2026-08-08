// The decisions `npx bookmarks-but-better@latest` makes, with no I/O in any of
// them: which installer this platform needs, which GitHub Release URL it comes
// from, and how the arguments the user typed reach that installer.
//
// Everything here is a pure function of its inputs, which is what lets
// `test/launcher.test.mjs` cover platform, argument and URL behaviour without
// a network, a temporary directory or a spawned process.

export const REPO = "farhadeidi/bookmarks-but-better";
export const DEFAULT_GITHUB_BASE = "https://github.com";

/** The fixed-name installer each platform's release carries. */
export function installerAssetName(platform) {
  return platform === "win32" ? "install.ps1" : "install.sh";
}

/**
 * A GitHub Release asset URL, and never anything else — an installer fetched
 * from a branch or from the website is not the one that was released and
 * checksummed.
 *
 * `tag` of `null` means the latest release, which GitHub serves under its own
 * `/releases/latest/download/` path.
 */
export function releaseAssetUrl({
  name,
  tag = null,
  repo = REPO,
  base = DEFAULT_GITHUB_BASE,
}) {
  const root = `${base.replace(/\/+$/, "")}/${repo}/releases`;
  return tag
    ? `${root}/download/${tag}/${name}`
    : `${root}/latest/download/${name}`;
}

/** The `<hash>  <filename>` sidecar published next to every release asset. */
export function checksumAssetName(name) {
  return `${name}.sha256`;
}

/** The hash out of a `sha256sum`/`shasum -a 256` sidecar line. */
export function parseChecksumSidecar(text) {
  const hash = String(text).trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error(`malformed .sha256 sidecar: ${JSON.stringify(text)}`);
  }
  return hash.toLowerCase();
}

// Every flag this launcher understands is a flag the installers already have.
// It adds none of its own, so there is one set of options to document and no
// way for the two layers to disagree about what one of them means.
//
// `windows` is the install.ps1 parameter the flag becomes; `null` marks a flag
// install.ps1 has no equivalent for.
const OPTIONS = new Map([
  ["--beta", { takesValue: false, windows: "-Beta" }],
  ["--version", { takesValue: true, windows: "-Version" }],
  ["--install-dir", { takesValue: true, windows: "-InstallDir" }],
  ["--bin-dir", { takesValue: true, windows: null }],
  ["--skip-setup", { takesValue: false, windows: "-SkipSetup" }],
]);

export const SUPPORTED_FLAGS = [...OPTIONS.keys()];

export const USAGE = `Usage: npx bookmarks-but-better@latest [options]

Downloads the official installer from the matching GitHub Release, verifies it
against its published SHA-256, installs the bookmarks-but-better daemon into a
persistent user-local directory, and runs \`bookmarks-but-better setup\`.

Options:
  --beta                Install the latest prerelease instead of the latest
                        stable release.
  --version <tag>       Install exactly this release, e.g. v4.0.0. The
                        installer is taken from that same release.
  --install-dir <dir>   Where versions are unpacked.
  --bin-dir <dir>       Where the \`bookmarks-but-better\` symlink is created.
                        macOS and Linux only.
  --skip-setup          Install the daemon but do not run setup afterward.
  -h, --help            Show this help.`;

/**
 * Splits what the user typed into "show help", "pass this on", and "this is
 * not a thing" — deliberately rejecting an unknown flag here rather than
 * forwarding it, so a typo is a message from this tool instead of an installer
 * error the user never invoked directly.
 */
export function parseArgs(argv) {
  const forwarded = [];
  const errors = [];
  let help = false;
  let version = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      help = true;
      continue;
    }
    const option = OPTIONS.get(argument);
    if (!option) {
      errors.push(`unrecognized argument: ${argument}`);
      continue;
    }
    if (!option.takesValue) {
      forwarded.push(argument);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) {
      errors.push(`${argument} needs an argument`);
      continue;
    }
    index += 1;
    forwarded.push(argument, value);
    if (argument === "--version") {
      version = value;
    }
  }

  return { help, forwarded, errors, version };
}

/**
 * The release whose installer to fetch. `--version` pins both halves to the
 * same release, so the script that runs is the one published alongside the
 * archive it is about to install; everything else takes the latest.
 */
export function releaseTagFor({ version }) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

/**
 * How the downloaded installer is executed on this platform, including the
 * translation of the forwarded flags into install.ps1's parameter names.
 *
 * Throws when a flag has no equivalent on the target platform — silently
 * dropping it would install to somewhere other than where the user asked.
 */
export function commandFor({ platform, scriptPath, forwarded = [] }) {
  if (platform !== "win32") {
    return { command: "bash", args: [scriptPath, ...forwarded] };
  }

  const translated = [];
  for (let index = 0; index < forwarded.length; index += 1) {
    const flag = forwarded[index];
    const option = OPTIONS.get(flag);
    if (!option) {
      throw new Error(`cannot forward ${flag}`);
    }
    if (option.windows === null) {
      throw new Error(`${flag} is not supported on Windows`);
    }
    translated.push(option.windows);
    if (option.takesValue) {
      index += 1;
      translated.push(forwarded[index]);
    }
  }

  return {
    // No `-NonInteractive`: the installer finishes by running setup, which
    // asks where the vault should live and cannot answer itself.
    command: "powershell",
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...translated,
    ],
  };
}
