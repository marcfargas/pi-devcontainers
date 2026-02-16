import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs and paths before importing state
const mockFs: Record<string, string> = {};

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (mockFs[path]) return mockFs[path];
    throw new Error(`ENOENT: ${path}`);
  }),
  writeFileSync: vi.fn((path: string, content: string) => {
    mockFs[path] = content;
  }),
  mkdirSync: vi.fn(),
  existsSync: vi.fn((path: string) => path in mockFs),
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return {
    ...actual,
    sep: "/",
    resolve: (...args: string[]) => args[args.length - 1],
  };
});

import {
  saveContainer,
  getContainer,
  removeContainer,
  listContainers,
  type ContainerState,
} from "../../packages/cli/src/state.js";

describe("state", () => {
  beforeEach(() => {
    // Clear mock filesystem
    for (const key of Object.keys(mockFs)) {
      delete mockFs[key];
    }
  });

  const entry: ContainerState = {
    containerId: "abc123def456",
    workspaceFolder: "/home/testuser/projects/myapp",
    configDir: "/tmp/pidc-12345",
    settingsDir: "/tmp/pi-settings-12345",
    startedAt: "2026-02-16T10:00:00.000Z",
  };

  it("saves and retrieves a container", () => {
    saveContainer(entry);
    const result = getContainer("/home/testuser/projects/myapp");
    expect(result).not.toBeNull();
    expect(result!.containerId).toBe("abc123def456");
    expect(result!.configDir).toBe("/tmp/pidc-12345");
  });

  it("returns null for unknown workspace", () => {
    const result = getContainer("/unknown/workspace");
    expect(result).toBeNull();
  });

  it("removes a container", () => {
    saveContainer(entry);
    removeContainer("/home/testuser/projects/myapp");
    const result = getContainer("/home/testuser/projects/myapp");
    expect(result).toBeNull();
  });

  it("lists all containers", () => {
    saveContainer(entry);
    saveContainer({
      ...entry,
      containerId: "xyz789",
      workspaceFolder: "/home/testuser/projects/other",
    });
    const list = listContainers();
    expect(list).toHaveLength(2);
  });

  it("overwrites existing entry for same workspace", () => {
    saveContainer(entry);
    saveContainer({
      ...entry,
      containerId: "newid999",
    });
    const result = getContainer("/home/testuser/projects/myapp");
    expect(result!.containerId).toBe("newid999");
    expect(listContainers()).toHaveLength(1);
  });

  it("handles corrupt state file gracefully", () => {
    // Write garbage to state file
    const statePath = "/home/testuser/.pi/devcontainers-state.json";
    mockFs[statePath] = "not valid json!!!";
    const result = getContainer("/any/path");
    expect(result).toBeNull();
  });
});
