// Where the installers put things, found the same way they decided it.

import assert from "node:assert/strict";
import test from "node:test";

import { configPath, contractHome, expandHome, installLayout } from "../lib/layout.mjs";

test("macOS and Linux: the install.sh defaults, and a symlink on ~/.local/bin", () => {
  const layout = installLayout({ platform: "darwin", env: {}, homedir: "/Users/me" });
  assert.equal(layout.installRoot, "/Users/me/.local/share/bookmarks-but-better");
  assert.equal(layout.binary, "/Users/me/.local/share/bookmarks-but-better/current/bookmarks-but-better");
  assert.equal(layout.uiDir, "/Users/me/.local/share/bookmarks-but-better/current/ui");
  assert.equal(layout.binLink, "/Users/me/.local/bin/bookmarks-but-better");
});

test("macOS and Linux: an explicit directory beats the environment, which beats the default", () => {
  const env = { BOOKMARKS_BUT_BETTER_INSTALL_ROOT: "/srv/bbb", BOOKMARKS_BUT_BETTER_BIN_DIR: "/srv/bin" };
  const fromEnv = installLayout({ platform: "linux", env, homedir: "/home/me" });
  assert.equal(fromEnv.binary, "/srv/bbb/current/bookmarks-but-better");
  assert.equal(fromEnv.binLink, "/srv/bin/bookmarks-but-better");

  const explicit = installLayout({ platform: "linux", env, homedir: "/home/me", installDir: "/opt/bbb", binDir: "/opt/bin" });
  assert.equal(explicit.binary, "/opt/bbb/current/bookmarks-but-better");
  assert.equal(explicit.binLink, "/opt/bin/bookmarks-but-better");
});

test("Windows: the install.ps1 defaults under LOCALAPPDATA, and no symlink", () => {
  const layout = installLayout({
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    homedir: "C:\\Users\\me",
  });
  assert.equal(layout.installRoot, "C:\\Users\\me\\AppData\\Local\\bookmarks-but-better");
  assert.equal(layout.binary, "C:\\Users\\me\\AppData\\Local\\bookmarks-but-better\\current\\bookmarks-but-better.exe");
  assert.equal(layout.uiDir, "C:\\Users\\me\\AppData\\Local\\bookmarks-but-better\\current\\ui");
  assert.equal(layout.binLink, null);

  const explicit = installLayout({ platform: "win32", env: {}, homedir: "C:\\Users\\me", installDir: "D:\\bbb" });
  assert.equal(explicit.binary, "D:\\bbb\\current\\bookmarks-but-better.exe");
});

test("the configuration lives where the daemon keeps it", () => {
  assert.equal(
    configPath({ platform: "linux", env: {}, homedir: "/home/me" }),
    "/home/me/.config/bookmarks-but-better/config.toml",
  );
  assert.equal(
    configPath({ platform: "linux", env: { XDG_CONFIG_HOME: "/etc/xdg-me" }, homedir: "/home/me" }),
    "/etc/xdg-me/bookmarks-but-better/config.toml",
  );
  assert.equal(
    configPath({ platform: "win32", env: {}, homedir: "C:\\Users\\me" }),
    "C:\\Users\\me\\.config\\bookmarks-but-better\\config.toml",
  );
});

test("~ expands as a shell would, and contracts back for display", () => {
  assert.equal(expandHome("~", "/home/me"), "/home/me");
  assert.equal(expandHome("~/Bookmarks", "/home/me"), "/home/me/Bookmarks");
  assert.equal(expandHome("/srv/vault", "/home/me"), "/srv/vault");
  assert.equal(expandHome("~user/x", "/home/me"), "~user/x");

  assert.equal(contractHome("/home/me/Bookmarks", "/home/me"), "~/Bookmarks");
  assert.equal(contractHome("/home/me", "/home/me"), "~");
  assert.equal(contractHome("/home/meow/x", "/home/me"), "/home/meow/x");
  assert.equal(contractHome("C:\\Users\\me\\Bookmarks", "C:\\Users\\me"), "~\\Bookmarks");
});
