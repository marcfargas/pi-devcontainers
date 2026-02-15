/**
 * Test mergeDevcontainerJson with real-world fixture files.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { mergeDevcontainerJson, type DevcontainerJson } from "../../packages/cli/src/merge.js";
import type { PiDevcontainerConfig } from "../../packages/cli/src/config.js";

const FIXTURES = resolve(__dirname, "../integration/fixtures");

const DEFAULT_CONFIG: PiDevcontainerConfig = {
  nodeVersion: "22.14.0",
  piVersion: "latest",
  mode: "holdpty",
  writable: ["todos", "memoria"],
  extensions: "pack",
  env: {},
  defaultImage: "mcr.microsoft.com/devcontainers/universal:latest",
};

function readFixture(name: string): DevcontainerJson {
  const raw = readFileSync(
    join(FIXTURES, name, ".devcontainer", "devcontainer.json"),
    "utf-8"
  );
  return JSON.parse(raw) as DevcontainerJson;
}

describe("merge with basic fixture", () => {
  const project = readFixture("basic");

  it("preserves the project image", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    expect(merged.image).toBe("mcr.microsoft.com/devcontainers/base:ubuntu");
  });

  it("preserves existing features and adds pi", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    const features = merged.features!;
    expect(features["ghcr.io/devcontainers/features/git:1"]).toEqual({});
    // Pi feature should be there too
    const piFeatureKeys = Object.keys(features).filter(
      (k) => !k.includes("devcontainers/features")
    );
    expect(piFeatureKeys.length).toBe(1);
  });

  it("chains string postCreateCommand", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    expect(merged.postCreateCommand).toBe(
      "echo 'Project setup done' && /opt/pi/setup.sh"
    );
  });

  it("preserves project remoteEnv and adds pi env", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {
      BROKER_URL: "http://broker:9999",
    });
    expect(merged.remoteEnv!.PROJECT_ENV).toBe("test");
    expect(merged.remoteEnv!.BROKER_URL).toBe("http://broker:9999");
  });
});

describe("merge with complex fixture", () => {
  const project = readFixture("complex");

  it("preserves all complex project properties", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    expect(merged.forwardPorts).toEqual([8080]);
    expect(merged.customizations).toEqual({
      vscode: { extensions: ["rust-lang.rust-analyzer"] },
    });
  });

  it("preserves existing features (rust + git) and adds pi", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    const features = merged.features!;
    expect(features["ghcr.io/devcontainers/features/rust:1"]).toEqual({
      version: "latest",
    });
    expect(features["ghcr.io/devcontainers/features/git:1"]).toEqual({});
  });

  it("appends pi mounts to existing mounts", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    // First mount should be the original cargo cache
    expect(merged.mounts![0]).toBe(
      "source=cargo-cache,target=/usr/local/cargo/registry,type=volume"
    );
    // Should have additional pi mounts
    expect(merged.mounts!.length).toBeGreaterThan(1);
  });

  it("adds pi-setup to object postCreateCommand", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    const postCreate = merged.postCreateCommand as Record<string, unknown>;
    expect(postCreate["install-deps"]).toBe("cargo build");
    expect(postCreate["setup-tools"]).toBe("cargo install cargo-watch");
    expect(postCreate["pi-setup"]).toBe("/opt/pi/setup.sh");
  });

  it("preserves project remoteEnv (takes precedence)", () => {
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {
      RUST_LOG: "info", // Try to override — should fail
    });
    expect(merged.remoteEnv!.RUST_LOG).toBe("debug"); // Project wins
    expect(merged.remoteEnv!.CARGO_HOME).toBe("/usr/local/cargo");
  });
});

describe("merge with minimal fixture (no devcontainer.json)", () => {
  it("generates config with default image", () => {
    const merged = mergeDevcontainerJson({}, DEFAULT_CONFIG, {});
    expect(merged.image).toBe(
      "mcr.microsoft.com/devcontainers/universal:latest"
    );
  });

  it("has pi feature, mounts, and postCreateCommand", () => {
    const merged = mergeDevcontainerJson({}, DEFAULT_CONFIG, {});
    expect(Object.keys(merged.features!).length).toBe(1);
    expect(merged.mounts!.length).toBeGreaterThan(0);
    expect(merged.postCreateCommand).toBe("/opt/pi/setup.sh");
  });
});
