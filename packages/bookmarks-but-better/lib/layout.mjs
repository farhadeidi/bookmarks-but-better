// Where the installers put things, computed the same way they compute it, so
// this tool finds the daemon the installer left behind and nothing else.
// String answers only: nothing here touches the filesystem.

import path from "node:path";

/**
 * The install layout for `platform`. `installDir`/`binDir` are the explicit
 * `--install-dir`/`--bin-dir` the user gave, which beat the environment,
 * which beats the installer's defaults — the same precedence install.sh
 * applies.
 */
export function installLayout({
  platform,
  env = {},
  homedir,
  installDir = null,
  binDir = null,
}) {
  if (platform === "win32") {
    const p = path.win32;
    const root =
      installDir ||
      env.BOOKMARKS_BUT_BETTER_INSTALL_ROOT ||
      p.join(env.LOCALAPPDATA || p.join(homedir, "AppData", "Local"), "bookmarks-but-better");
    const current = p.join(root, "current");
    return {
      platform,
      installRoot: root,
      current,
      binary: p.join(current, "bookmarks-but-better.exe"),
      uiDir: p.join(current, "ui"),
      // install.ps1 puts `current` on the user's PATH instead of a symlink.
      binDir: null,
      binLink: null,
    };
  }

  const p = path.posix;
  const root =
    installDir ||
    env.BOOKMARKS_BUT_BETTER_INSTALL_ROOT ||
    p.join(homedir, ".local", "share", "bookmarks-but-better");
  const links = binDir || env.BOOKMARKS_BUT_BETTER_BIN_DIR || p.join(homedir, ".local", "bin");
  const current = p.join(root, "current");
  return {
    platform,
    installRoot: root,
    current,
    binary: p.join(current, "bookmarks-but-better"),
    uiDir: p.join(current, "ui"),
    binDir: links,
    binLink: p.join(links, "bookmarks-but-better"),
  };
}

/**
 * Where the daemon keeps its Vault Registry (ADR-0005), computed as the daemon
 * computes it, for the one moment there is no daemon binary left to ask: the
 * end of `uninstall`.
 */
export function configPath({ platform, env = {}, homedir }) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const configHome = env.XDG_CONFIG_HOME || p.join(homedir, ".config");
  return p.join(configHome, "bookmarks-but-better", "config.toml");
}

/** `~` and `~/…` as the shell would read them; anything else unchanged. */
export function expandHome(input, homedir) {
  if (input === "~") return homedir;
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir, input.slice(2));
  }
  return input;
}

/** The inverse, for display: a path under the home directory shown as `~/…`. */
export function contractHome(input, homedir) {
  if (!homedir || !input) return input;
  if (input === homedir) return "~";
  const separator = input.includes("\\") && !input.includes("/") ? "\\" : "/";
  if (input.startsWith(homedir + separator)) {
    return `~${separator}${input.slice(homedir.length + 1)}`;
  }
  return input;
}
