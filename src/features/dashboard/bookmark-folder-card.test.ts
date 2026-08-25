// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  readCollapsedFolders,
  storageKey,
  writeCollapsedFolders,
} from "./bookmark-folder-card";

describe("collapsed folder card persistence", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("derives a per-source storage key", () => {
    expect(storageKey("vault-a")).toBe(
      "bookmarks-but-better:collapsed-folders:vault-a",
    );
  });

  it("persists a distinct set of collapsed folders per source", () => {
    writeCollapsedFolders("vault-a", new Set(["react", "css"]));
    writeCollapsedFolders("vault-b", new Set(["rust"]));

    expect(readCollapsedFolders("vault-a")).toEqual(new Set(["react", "css"]));
    expect(readCollapsedFolders("vault-b")).toEqual(new Set(["rust"]));
  });

  it("returns an empty set when the source has stored nothing", () => {
    expect(readCollapsedFolders("vault-c")).toEqual(new Set());
  });

  it("ignores malformed stored values", () => {
    localStorage.setItem(
      "bookmarks-but-better:collapsed-folders:vault-d",
      "{not json",
    );
    expect(readCollapsedFolders("vault-d")).toEqual(new Set());
  });
});
