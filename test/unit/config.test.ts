import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveConfig, resolveEnvVars, type CliOverrides } from "../../packages/cli/src/config.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveConfig", () => {
  it("returns defaults when no user config or overrides", () => {
    const config = resolveConfig();
    expect(config.nodeVersion).toBe("22.14.0");
    expect(config.piVersion).toBe("latest");
    expect(config.mode).toBe("holdpty");
    expect(config.writable).toContain("todos");
    expect(config.writable).toContain("memoria");
    expect(config.extensions).toBe("pack");
    expect(config.defaultImage).toBe(
      "mcr.microsoft.com/devcontainers/base:ubuntu"
    );
  });

  it("CLI mode override takes precedence", () => {
    const config = resolveConfig({ mode: "pi-server" });
    expect(config.mode).toBe("pi-server");
  });

  it("CLI writable paths are merged with defaults", () => {
    const config = resolveConfig({ writable: ["custom-dir"] });
    expect(config.writable).toContain("todos");
    expect(config.writable).toContain("memoria");
    expect(config.writable).toContain("custom-dir");
  });

  it("deduplicates writable paths", () => {
    const config = resolveConfig({ writable: ["todos"] });
    const todosCount = config.writable.filter((w) => w === "todos").length;
    expect(todosCount).toBe(1);
  });

  it("--no-extensions sets extensions to skip", () => {
    const config = resolveConfig({ noExtensions: true });
    expect(config.extensions).toBe("skip");
  });

  it("CLI env overrides are merged", () => {
    const config = resolveConfig({
      env: { CUSTOM_VAR: "value", COPY_VAR: null },
    });
    expect(config.env.CUSTOM_VAR).toBe("value");
    expect(config.env.COPY_VAR).toBeNull();
  });
});

describe("project-level config", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `pidc-config-test-${Date.now()}`);
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });

  it("reads project .pi/devcontainers.json", () => {
    writeFileSync(
      join(projectDir, ".pi", "devcontainers.json"),
      JSON.stringify({ defaultImage: "node:22" })
    );
    const config = resolveConfig({ workspaceFolder: projectDir });
    expect(config.defaultImage).toBe("node:22");
  });

  it("project config overrides user defaults", () => {
    writeFileSync(
      join(projectDir, ".pi", "devcontainers.json"),
      JSON.stringify({ mode: "pi-server" })
    );
    const config = resolveConfig({ workspaceFolder: projectDir });
    expect(config.mode).toBe("pi-server");
  });

  it("CLI flags override project config", () => {
    writeFileSync(
      join(projectDir, ".pi", "devcontainers.json"),
      JSON.stringify({ mode: "pi-server" })
    );
    const config = resolveConfig({ workspaceFolder: projectDir, mode: "holdpty" });
    expect(config.mode).toBe("holdpty");
  });

  it("project writable paths are merged with user defaults", () => {
    writeFileSync(
      join(projectDir, ".pi", "devcontainers.json"),
      JSON.stringify({ writable: ["custom-data"] })
    );
    const config = resolveConfig({ workspaceFolder: projectDir });
    expect(config.writable).toContain("todos");
    expect(config.writable).toContain("memoria");
    expect(config.writable).toContain("custom-data");
  });

  it("project env is merged over user env", () => {
    writeFileSync(
      join(projectDir, ".pi", "devcontainers.json"),
      JSON.stringify({ env: { PROJECT_VAR: "pval" } })
    );
    const config = resolveConfig({ workspaceFolder: projectDir });
    expect(config.env.PROJECT_VAR).toBe("pval");
  });

  it("returns defaults when project has no .pi/devcontainers.json", () => {
    const config = resolveConfig({ workspaceFolder: projectDir });
    expect(config.nodeVersion).toBe("22.14.0");
    expect(config.defaultImage).toBe("mcr.microsoft.com/devcontainers/base:ubuntu");
  });

  it("parses JSONC comments and trailing commas", () => {
    writeFileSync(
      join(projectDir, ".pi", "devcontainers.json"),
      `{
        // comment
        "defaultImage": "node:22",
        "writable": ["cache",],
      }`
    );
    const config = resolveConfig({ workspaceFolder: projectDir });
    expect(config.defaultImage).toBe("node:22");
    expect(config.writable).toContain("cache");
  });

  it("preserves // inside string values (e.g. URLs)", () => {
    writeFileSync(
      join(projectDir, ".pi", "devcontainers.json"),
      `{
        "env": {
          "BROKER_URL": "https://broker.example.com"
        }
      }`
    );
    const config = resolveConfig({ workspaceFolder: projectDir });
    expect(config.env.BROKER_URL).toBe("https://broker.example.com");
  });
});

describe("resolveEnvVars", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, HOST_VAR: "host-value" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("passes through explicit values", () => {
    const result = resolveEnvVars({ MY_VAR: "explicit" });
    expect(result.MY_VAR).toBe("explicit");
  });

  it("copies null values from host environment", () => {
    const result = resolveEnvVars({ HOST_VAR: null });
    expect(result.HOST_VAR).toBe("host-value");
  });

  it("skips null values not present in host environment", () => {
    const result = resolveEnvVars({ MISSING_VAR: null });
    expect(result).not.toHaveProperty("MISSING_VAR");
  });

  it("handles mixed explicit and null values", () => {
    const result = resolveEnvVars({
      HOST_VAR: null,
      EXPLICIT: "value",
      MISSING: null,
    });
    expect(result).toEqual({
      HOST_VAR: "host-value",
      EXPLICIT: "value",
    });
  });

  it("returns empty object for empty input", () => {
    const result = resolveEnvVars({});
    expect(result).toEqual({});
  });
});
