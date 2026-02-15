import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findLinkedExtensions } from "../../packages/cli/src/extensions.js";
import { mkdirSync, symlinkSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("findLinkedExtensions", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pi-ext-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup failure is ok in tests
    }
  });

  it("returns empty array for non-existent directory", () => {
    const result = findLinkedExtensions("/nonexistent/path");
    expect(result).toEqual([]);
  });

  it("returns empty array for directory with no linked packages", () => {
    // Create a regular (non-linked) package
    const pkgDir = join(testDir, "regular-pkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), '{"name": "regular-pkg"}');

    const result = findLinkedExtensions(testDir);
    expect(result).toEqual([]);
  });

  it("detects symlinked packages", () => {
    // Create a "real" package somewhere
    const realPkgDir = join(tmpdir(), `pi-ext-real-${Date.now()}`);
    mkdirSync(realPkgDir, { recursive: true });
    writeFileSync(join(realPkgDir, "package.json"), '{"name": "linked-pkg"}');

    // Create symlink in test node_modules
    const linkPath = join(testDir, "linked-pkg");
    try {
      symlinkSync(realPkgDir, linkPath, "junction"); // junction for Windows compat
    } catch {
      // If symlinks aren't supported, skip
      return;
    }

    const result = findLinkedExtensions(testDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("linked-pkg");

    // Cleanup
    rmSync(realPkgDir, { recursive: true, force: true });
  });

  it("detects scoped symlinked packages", () => {
    // Create a "real" scoped package
    const realPkgDir = join(tmpdir(), `pi-ext-scoped-${Date.now()}`);
    mkdirSync(realPkgDir, { recursive: true });
    writeFileSync(
      join(realPkgDir, "package.json"),
      '{"name": "@scope/linked-pkg"}'
    );

    // Create scoped dir and symlink
    const scopeDir = join(testDir, "@scope");
    mkdirSync(scopeDir, { recursive: true });
    const linkPath = join(scopeDir, "linked-pkg");
    try {
      symlinkSync(realPkgDir, linkPath, "junction");
    } catch {
      return;
    }

    const result = findLinkedExtensions(testDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("@scope/linked-pkg");

    // Cleanup
    rmSync(realPkgDir, { recursive: true, force: true });
  });

  it("skips regular (non-linked) packages in scoped dirs", () => {
    const scopeDir = join(testDir, "@scope");
    mkdirSync(scopeDir, { recursive: true });
    const pkgDir = join(scopeDir, "regular-pkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      '{"name": "@scope/regular-pkg"}'
    );

    const result = findLinkedExtensions(testDir);
    expect(result).toEqual([]);
  });
});
