import { describe, it, expect } from "vitest";
import {
  mergeDevcontainerJson,
  chainPostCreateCommand,
  generateMinimalDevcontainerJson,
  type DevcontainerJson,
} from "../../packages/cli/src/merge.js";
import type { PiDevcontainerConfig } from "../../packages/cli/src/config.js";

const DEFAULT_CONFIG: PiDevcontainerConfig = {
  nodeVersion: "22.14.0",
  piVersion: "latest",
  mode: "holdpty",
  writable: ["todos", "memoria"],
  extensions: "pack",
  env: {},
  defaultImage: "mcr.microsoft.com/devcontainers/universal:latest",
};

describe("chainPostCreateCommand", () => {
  describe("with string existing command", () => {
    it("chains with &&", () => {
      const result = chainPostCreateCommand("npm install", "/opt/pi/setup.sh");
      expect(result).toBe("npm install && /opt/pi/setup.sh");
    });

    it("handles complex string commands", () => {
      const result = chainPostCreateCommand(
        'echo "hello world" && npm install',
        "/opt/pi/setup.sh"
      );
      expect(result).toBe(
        'echo "hello world" && npm install && /opt/pi/setup.sh'
      );
    });
  });

  describe("with array existing command", () => {
    it("converts to object format with named commands", () => {
      const result = chainPostCreateCommand(
        ["npm", "install"],
        "/opt/pi/setup.sh"
      );
      expect(result).toEqual({
        "project-setup": ["npm", "install"],
        "pi-setup": "/opt/pi/setup.sh",
      });
    });
  });

  describe("with object existing command", () => {
    it("adds pi-setup key to existing object", () => {
      const existing = {
        "install-deps": "npm install",
        "setup-db": "npm run db:migrate",
      };
      const result = chainPostCreateCommand(existing, "/opt/pi/setup.sh");
      expect(result).toEqual({
        "install-deps": "npm install",
        "setup-db": "npm run db:migrate",
        "pi-setup": "/opt/pi/setup.sh",
      });
    });

    it("does not overwrite existing keys", () => {
      const existing = {
        "install-deps": "npm install",
      };
      const result = chainPostCreateCommand(existing, "/opt/pi/setup.sh") as Record<string, unknown>;
      expect(result["install-deps"]).toBe("npm install");
      expect(result["pi-setup"]).toBe("/opt/pi/setup.sh");
    });
  });

  describe("with null/undefined existing command", () => {
    it("returns new command for undefined", () => {
      const result = chainPostCreateCommand(undefined, "/opt/pi/setup.sh");
      expect(result).toBe("/opt/pi/setup.sh");
    });

    it("returns new command for null", () => {
      const result = chainPostCreateCommand(
        null as unknown as undefined,
        "/opt/pi/setup.sh"
      );
      expect(result).toBe("/opt/pi/setup.sh");
    });
  });
});

describe("mergeDevcontainerJson", () => {
  it("preserves all existing project properties", () => {
    const project: DevcontainerJson = {
      image: "node:20",
      forwardPorts: [3000],
      customizations: { vscode: { extensions: ["ms-python.python"] } },
    };

    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});

    expect(merged.image).toBe("node:20");
    expect(merged.forwardPorts).toEqual([3000]);
    expect(merged.customizations).toEqual({
      vscode: { extensions: ["ms-python.python"] },
    });
  });

  it("adds pi feature to existing features", () => {
    const project: DevcontainerJson = {
      image: "node:20",
      features: {
        "ghcr.io/devcontainers/features/git:1": {},
      },
    };

    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {}, {
      featureRef: "ghcr.io/marcfargas/pi:1",
    });

    // Existing feature preserved
    expect(merged.features!["ghcr.io/devcontainers/features/git:1"]).toEqual(
      {}
    );
    // Pi feature added
    expect(merged.features!["ghcr.io/marcfargas/pi:1"]).toEqual({
      nodeVersion: "22.14.0",
      piVersion: "latest",
    });
  });

  it("adds default image when project has none", () => {
    const merged = mergeDevcontainerJson({}, DEFAULT_CONFIG, {});
    expect(merged.image).toBe(
      "mcr.microsoft.com/devcontainers/universal:latest"
    );
  });

  it("does not override existing image", () => {
    const project: DevcontainerJson = { image: "ubuntu:22.04" };
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    expect(merged.image).toBe("ubuntu:22.04");
  });

  it("does not add image when build is present", () => {
    const project: DevcontainerJson = {
      build: { dockerfile: "Dockerfile" },
    };
    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});
    expect(merged.image).toBeUndefined();
  });

  it("appends mounts to existing mounts", () => {
    const project: DevcontainerJson = {
      image: "node:20",
      mounts: ["source=data,target=/data,type=volume"],
    };

    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});

    // Existing mount preserved
    expect(merged.mounts![0]).toBe(
      "source=data,target=/data,type=volume"
    );
    // Pi mounts added (RO config + writable volumes)
    expect(merged.mounts!.length).toBeGreaterThan(1);

    // Find the RO host config mount
    const hostMount = merged.mounts!.find(
      (m) => typeof m === "object" && m.target === "/opt/pi-host-config"
    );
    expect(hostMount).toBeDefined();
  });

  it("adds writable volume mounts for configured dirs", () => {
    const merged = mergeDevcontainerJson({}, DEFAULT_CONFIG, {});

    const mounts = merged.mounts as Array<{ type: string; source: string; target: string }>;
    const todoMount = mounts.find((m) =>
      typeof m === "object" && m.target === "/home/node/.pi/todos"
    );
    const memoriaMount = mounts.find((m) =>
      typeof m === "object" && m.target === "/home/node/.pi/memoria"
    );

    expect(todoMount).toBeDefined();
    expect(todoMount!.type).toBe("volume");
    expect(memoriaMount).toBeDefined();
    expect(memoriaMount!.type).toBe("volume");
  });

  it("merges remoteEnv without overwriting project vars", () => {
    const project: DevcontainerJson = {
      image: "node:20",
      remoteEnv: { NODE_ENV: "development", PATH: "/usr/bin" },
    };

    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {
      BROKER_URL: "http://localhost:9999",
    });

    // Project vars preserved (take precedence)
    expect(merged.remoteEnv!.NODE_ENV).toBe("development");
    expect(merged.remoteEnv!.PATH).toBe("/usr/bin");
    // Pi vars added
    expect(merged.remoteEnv!.BROKER_URL).toBe("http://localhost:9999");
  });

  it("project remoteEnv takes precedence over pi env", () => {
    const project: DevcontainerJson = {
      image: "node:20",
      remoteEnv: { MY_VAR: "project-value" },
    };

    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {
      MY_VAR: "pi-value",
    });

    expect(merged.remoteEnv!.MY_VAR).toBe("project-value");
  });

  it("chains postCreateCommand", () => {
    const project: DevcontainerJson = {
      image: "node:20",
      postCreateCommand: "npm install",
    };

    const merged = mergeDevcontainerJson(project, DEFAULT_CONFIG, {});

    expect(merged.postCreateCommand).toBe(
      "npm install && /opt/pi/setup.sh"
    );
  });

  it("adds extension staging mount when provided", () => {
    const merged = mergeDevcontainerJson({}, DEFAULT_CONFIG, {}, {
      extensionStagingDir: "/tmp/pi-ext-staging",
    });

    const mounts = merged.mounts as Array<{ target: string; type: string }>;
    const extMount = mounts.find((m) =>
      typeof m === "object" && m.target === "/opt/pi-ext-staging"
    );
    expect(extMount).toBeDefined();
    expect(extMount!.type).toBe("bind");
  });
});

describe("generateMinimalDevcontainerJson", () => {
  it("generates config with default image", () => {
    const config = generateMinimalDevcontainerJson(DEFAULT_CONFIG, {});
    expect(config.image).toBe(
      "mcr.microsoft.com/devcontainers/universal:latest"
    );
  });

  it("includes pi feature", () => {
    const config = generateMinimalDevcontainerJson(DEFAULT_CONFIG, {});
    const featureKeys = Object.keys(config.features ?? {});
    expect(featureKeys.length).toBe(1);
  });

  it("includes mounts and postCreateCommand", () => {
    const config = generateMinimalDevcontainerJson(DEFAULT_CONFIG, {});
    expect(config.mounts!.length).toBeGreaterThan(0);
    expect(config.postCreateCommand).toBeDefined();
  });
});
