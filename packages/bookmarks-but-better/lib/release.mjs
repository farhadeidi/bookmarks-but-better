// Where the installer comes from and how it is run: which script this
// platform needs, which GitHub Release URL it is fetched from, and how the
// flags `install` chose reach it. Pure functions of their inputs, so
// `test/release.test.mjs` covers them without a network or a spawned process.

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

/**
 * The release whose installer to fetch: the one named by `--version`, so the
 * script that runs is the one published alongside the archive it installs;
 * the latest otherwise.
 */
export function releaseTagFor(flags) {
  const index = flags.indexOf("--version");
  if (index === -1) return null;
  const version = flags[index + 1];
  return version.startsWith("v") ? version : `v${version}`;
}

// Every flag forwarded to the installers, and what install.ps1 calls it.
// `null` marks a flag install.ps1 has no equivalent for.
const FLAGS = new Map([
  ["--beta", { takesValue: false, windows: "-Beta" }],
  ["--version", { takesValue: true, windows: "-Version" }],
  ["--install-dir", { takesValue: true, windows: "-InstallDir" }],
  ["--bin-dir", { takesValue: true, windows: null }],
  ["--vault", { takesValue: true, windows: "-Vault" }],
]);

/**
 * How the downloaded installer is executed on this platform, including the
 * translation of the forwarded flags into install.ps1's parameter names.
 *
 * Throws when a flag has no equivalent on the target platform — silently
 * dropping it would install to somewhere other than where the user asked.
 */
export function commandFor({ platform, scriptPath, forwarded = [] }) {
  if (platform !== "win32") {
    // `bash`, never `sh`: install.sh uses `set -o pipefail`, a bash builtin
    // option, and /bin/sh is dash on Debian and Ubuntu.
    return { command: "bash", args: [scriptPath, ...forwarded] };
  }

  const translated = [];
  for (let index = 0; index < forwarded.length; index += 1) {
    const flag = forwarded[index];
    const option = FLAGS.get(flag);
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
    command: "powershell",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      ...translated,
    ],
  };
}
