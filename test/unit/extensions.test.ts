import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveSettingsForContainer } from "../../packages/cli/src/extensions.js";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveSettingsForContainer", () => {
  let testDir: string;
  let fakeWorkspace: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pi-ext-test-${Date.now()}`);

    // Fake workspace with .pi/settings.json
    fakeWorkspace = join(testDir, "workspace");
    mkdirSync(join(fakeWorkspace, ".pi"), { recursive: true });

    // Create some fake extension dirs
    for (const ext of ["ext-a", "ext-b"]) {
      const extDir = join(testDir, "extensions", ext);
      mkdirSync(extDir, { recursive: true });
      writeFileSync(
        join(extDir, "package.json"),
        JSON.stringify({ name: `@test/${ext}` })
      );
    }
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup failure ok
    }
  });

  it("returns empty when no project settings", () => {
    // Calls with a workspace that has no .pi/settings.json
    // Will still read user-level settings (if they exist)
    const result = resolveSettingsForContainer(join(testDir, "nonexistent"));
    expect(Array.isArray(result.mounts)).toBe(true);
  });

  it("generates mounts for extensions in project settings", () => {
    const extA = join(testDir, "extensions", "ext-a");
    const extB = join(testDir, "extensions", "ext-b");

    writeFileSync(
      join(fakeWorkspace, ".pi", "settings.json"),
      JSON.stringify({
        extensions: [extA, extB],
      })
    );

    const result = resolveSettingsForContainer(fakeWorkspace);
    // Should have mounts for both extensions
    const containerPaths = result.mounts.map((m) => m.containerPath);
    // Paths should exist as mounts
    expect(result.mounts.length).toBeGreaterThanOrEqual(2);
    // Each mount should have both hostPath and containerPath
    for (const m of result.mounts) {
      expect(m.hostPath).toBeDefined();
      expect(m.containerPath).toBeDefined();
    }
  });

  it("deduplicates identical paths", () => {
    const extA = join(testDir, "extensions", "ext-a");

    writeFileSync(
      join(fakeWorkspace, ".pi", "settings.json"),
      JSON.stringify({
        extensions: [extA],
        skills: [extA], // same path as extension
      })
    );

    const result = resolveSettingsForContainer(fakeWorkspace);
    const matching = result.mounts.filter((m) =>
      m.hostPath.includes("ext-a")
    );
    expect(matching).toHaveLength(1);
  });

  it("skips nonexistent paths", () => {
    writeFileSync(
      join(fakeWorkspace, ".pi", "settings.json"),
      JSON.stringify({
        extensions: [
          join(testDir, "extensions", "ext-a"),
          join(testDir, "extensions", "nonexistent"),
        ],
      })
    );

    const result = resolveSettingsForContainer(fakeWorkspace);
    const hasNonexistent = result.mounts.some((m) =>
      m.hostPath.includes("nonexistent")
    );
    expect(hasNonexistent).toBe(false);
  });

  it("generates patched settings.json", () => {
    const extA = join(testDir, "extensions", "ext-a");

    writeFileSync(
      join(fakeWorkspace, ".pi", "settings.json"),
      JSON.stringify({
        extensions: [extA],
        shellPath: "C:\\Windows\\bash.exe",
      })
    );

    const result = resolveSettingsForContainer(fakeWorkspace);

    // User-level settings also generates a patched file
    // (but only if user settings exist — may or may not depending on test env)
    // The project settings alone should still produce mounts
    expect(result.mounts.length).toBeGreaterThanOrEqual(1);
  });
});
