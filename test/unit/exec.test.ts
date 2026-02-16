import { describe, it, expect } from "vitest";
import {
  extractJson,
  parseDevcontainerUpResult,
} from "../../packages/cli/src/exec.js";

describe("extractJson", () => {
  it("parses clean JSON (no log lines)", () => {
    const raw = '{"outcome":"success","containerId":"abc123","remoteWorkspaceFolder":"/workspaces/project"}';
    const result = extractJson(raw) as Record<string, unknown>;
    expect(result.containerId).toBe("abc123");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/project");
  });

  it("extracts JSON from output with lifecycle hook log lines", () => {
    const raw = [
      "[1234 ms] Start: Run in container: npm install",
      "added 42 packages in 3s",
      "",
      '{"outcome":"success","containerId":"abc123","remoteWorkspaceFolder":"/workspaces/project"}',
    ].join("\n");
    const result = extractJson(raw) as Record<string, unknown>;
    expect(result.containerId).toBe("abc123");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/project");
  });

  it("extracts JSON when postCreateCommand fails (outcome error)", () => {
    const raw = [
      "[1234 ms] Start: Run in container: npm install",
      "npm ERR! missing script: install",
      '{"outcome":"error","containerId":"def456","remoteWorkspaceFolder":"/workspaces/my-app"}',
    ].join("\n");
    const result = extractJson(raw) as Record<string, unknown>;
    expect(result.containerId).toBe("def456");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/my-app");
    expect(result.outcome).toBe("error");
  });

  it("handles multiple log lines with curly braces in output", () => {
    const raw = [
      "[1234 ms] Start: Run in container: echo '{hello}'",
      "{invalid json here",
      '{"outcome":"success","containerId":"ghi789","remoteWorkspaceFolder":"/workspaces/test"}',
    ].join("\n");
    const result = extractJson(raw) as Record<string, unknown>;
    expect(result.containerId).toBe("ghi789");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/test");
  });

  it("returns null for completely unparseable output", () => {
    const result = extractJson("total garbage\nno json here");
    expect(result).toBeNull();
  });

  it("handles trailing newline after JSON", () => {
    const raw = '{"containerId":"abc","remoteWorkspaceFolder":"/workspaces/p"}\n';
    const result = extractJson(raw) as Record<string, unknown>;
    expect(result.containerId).toBe("abc");
  });
});

describe("parseDevcontainerUpResult", () => {
  it("parses clean JSON output", () => {
    const raw = '{"outcome":"success","containerId":"abc123","remoteWorkspaceFolder":"/workspaces/project"}';
    const result = parseDevcontainerUpResult(raw);
    expect(result.containerId).toBe("abc123");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/project");
  });

  it("preserves remoteWorkspaceFolder when log lines precede JSON", () => {
    const raw = [
      "[1234 ms] Start: Run in container: npm install",
      "added 42 packages in 3s",
      '{"outcome":"success","containerId":"abc123","remoteWorkspaceFolder":"/workspaces/project"}',
    ].join("\n");
    const result = parseDevcontainerUpResult(raw);
    expect(result.containerId).toBe("abc123");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/project");
  });

  it("extracts both containerId and remoteWorkspaceFolder via regex fallback", () => {
    // Simulate truly corrupt output where no line is valid JSON,
    // but the key-value pairs are still present
    const raw = 'prefix {"containerId":"abc123","remoteWorkspaceFolder":"/workspaces/project"} suffix';
    const result = parseDevcontainerUpResult(raw);
    expect(result.containerId).toBe("abc123");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/project");
  });

  it("handles postCreateCommand failure (non-success outcome)", () => {
    const raw = [
      "[1234 ms] Running postCreateCommand...",
      "Error: command failed",
      '{"outcome":"error","containerId":"def456","remoteWorkspaceFolder":"/workspaces/my-app"}',
    ].join("\n");
    const result = parseDevcontainerUpResult(raw);
    expect(result.containerId).toBe("def456");
    expect(result.remoteWorkspaceFolder).toBe("/workspaces/my-app");
  });

  it("throws when no containerId found", () => {
    expect(() => parseDevcontainerUpResult("no json here")).toThrow(
      "devcontainer up failed"
    );
  });

  it("throws with message from JSON when no containerId", () => {
    const raw = '{"outcome":"error","message":"Image not found"}';
    expect(() => parseDevcontainerUpResult(raw)).toThrow("Image not found");
  });
});
