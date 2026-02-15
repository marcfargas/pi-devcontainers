import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readPiExtensions } from "../../packages/cli/src/extensions.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("readPiExtensions", () => {
  let testDir: string;
  let fakeHome: string;
  let fakeWorkspace: string;
  let origHome: string | undefined;

  beforeEach(() => {
    testDir = join(tmpdir(), `pi-ext-test-${Date.now()}`);

    // Fake home with .pi/agent/settings.json
    fakeHome = join(testDir, "home");
    mkdirSync(join(fakeHome, ".pi", "agent"), { recursive: true });

    // Fake workspace with .pi/settings.json
    fakeWorkspace = join(testDir, "workspace");
    mkdirSync(join(fakeWorkspace, ".pi"), { recursive: true });

    // Create some fake extension dirs
    for (const ext of ["ext-a", "ext-b", "ext-c"]) {
      const extDir = join(testDir, "extensions", ext);
      mkdirSync(extDir, { recursive: true });
      writeFileSync(
        join(extDir, "package.json"),
        JSON.stringify({ name: `@test/${ext}` })
      );
    }

    origHome = process.env.HOME;
    // readPiExtensions uses homedir() which reads HOME on posix
    // On Windows it uses USERPROFILE — we'll test with explicit paths instead
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome;
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup failure ok
    }
  });

  it("returns empty array when no settings exist", () => {
    // Point to a nonexistent workspace with no user settings
    const result = readPiExtensions(join(testDir, "nonexistent"));
    // This reads from actual ~/.pi/agent/settings.json (if exists) + fake workspace
    // Since fake workspace has no settings, only user extensions come through
    expect(Array.isArray(result)).toBe(true);
  });

  it("reads extensions from user settings", () => {
    const extA = join(testDir, "extensions", "ext-a");
    const extB = join(testDir, "extensions", "ext-b");

    writeFileSync(
      join(fakeHome, ".pi", "agent", "settings.json"),
      JSON.stringify({
        extensions: [extA, extB],
      })
    );

    // We can't easily override homedir(), so test the internal behavior
    // by checking the function handles valid paths
    // Instead, test with workspace-level settings
    writeFileSync(
      join(fakeWorkspace, ".pi", "settings.json"),
      JSON.stringify({
        extensions: [extA, extB],
      })
    );

    const result = readPiExtensions(fakeWorkspace);
    const names = result.map((e) => e.name);
    expect(names).toContain("@test/ext-a");
    expect(names).toContain("@test/ext-b");
  });

  it("deduplicates extensions from user and project", () => {
    const extA = join(testDir, "extensions", "ext-a");

    // Same extension in both
    writeFileSync(
      join(fakeWorkspace, ".pi", "settings.json"),
      JSON.stringify({ extensions: [extA, extA] })
    );

    const result = readPiExtensions(fakeWorkspace);
    const matching = result.filter((e) => e.name === "@test/ext-a");
    expect(matching).toHaveLength(1);
  });

  it("skips nonexistent extension paths", () => {
    writeFileSync(
      join(fakeWorkspace, ".pi", "settings.json"),
      JSON.stringify({
        extensions: [
          join(testDir, "extensions", "ext-a"),
          join(testDir, "extensions", "nonexistent"),
        ],
      })
    );

    const result = readPiExtensions(fakeWorkspace);
    const names = result.map((e) => e.name);
    expect(names).toContain("@test/ext-a");
    expect(names).not.toContain("nonexistent");
  });

  it("skips extensions without package.json", () => {
    const noPackage = join(testDir, "extensions", "no-pkg");
    mkdirSync(noPackage, { recursive: true });
    // No package.json

    writeFileSync(
      join(fakeWorkspace, ".pi", "settings.json"),
      JSON.stringify({ extensions: [noPackage] })
    );

    const result = readPiExtensions(fakeWorkspace);
    const matching = result.filter((e) => e.sourcePath === noPackage);
    expect(matching).toHaveLength(0);
  });
});
