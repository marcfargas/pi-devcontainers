/**
 * Read and merge pi-devcontainers configuration.
 *
 * Config sources (precedence: CLI flags > project > user > defaults):
 * 1. CLI flags (--mode, --writable, --env, etc.)
 * 2. <project>/.pi/devcontainers.json (project overrides)
 * 3. ~/.pi/devcontainers.json (user preferences)
 * 4. Built-in defaults
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { piConfigDir, pathExists } from "./paths.js";

export interface PiDevcontainerConfig {
  /** Node.js version for isolated pi install */
  nodeVersion: string;
  /** pi package version */
  piVersion: string;
  /** How to run pi: holdpty or pi-server */
  mode: "holdpty" | "pi-server";
  /** Dirs under ~/.pi that should be writable Docker volumes (relative to ~/.pi) */
  writable: string[];
  /** How to handle npm-linked extensions */
  extensions: "pack" | "registry" | "skip";
  /** Environment variables: value = set explicitly, null = copy from host */
  env: Record<string, string | null>;
  /** Additional devcontainer features to inject (merged with pi feature) */
  features: Record<string, Record<string, unknown>>;
  /** Default base image for projects without devcontainer.json */
  defaultImage: string;
}

const DEFAULTS: PiDevcontainerConfig = {
  nodeVersion: "22.14.0",
  piVersion: "latest",
  mode: "holdpty",
  writable: ["todos", "memoria"],
  extensions: "pack",
  env: {},
  features: {},
  defaultImage: "mcr.microsoft.com/devcontainers/base:ubuntu",
};

/**
 * Read and parse a JSONC config file, returning partial config or empty object.
 */
function readConfigFile(configPath: string, label: string): Partial<PiDevcontainerConfig> {
  if (!pathExists(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    // Strip JSON comments (// and /* */) and trailing commas (JSONC → JSON)
    const stripped = raw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(stripped) as Partial<PiDevcontainerConfig>;
  } catch (err) {
    console.error(
      `Warning: Failed to parse ${label}: ${err instanceof Error ? err.message : err}`
    );
    return {};
  }
}

/**
 * Read ~/.pi/devcontainers.json if it exists.
 */
function readUserConfig(): Partial<PiDevcontainerConfig> {
  return readConfigFile(join(piConfigDir(), "devcontainers.json"), "~/.pi/devcontainers.json");
}

/**
 * Read <project>/.pi/devcontainers.json if it exists.
 */
function readProjectConfig(workspaceFolder: string): Partial<PiDevcontainerConfig> {
  return readConfigFile(join(workspaceFolder, ".pi", "devcontainers.json"), ".pi/devcontainers.json");
}

export interface CliOverrides {
  mode?: "holdpty" | "pi-server";
  writable?: string[];
  env?: Record<string, string | null>;
  rebuild?: boolean;
  noExtensions?: boolean;
  /** Workspace folder — used to find project-level .pi/devcontainers.json */
  workspaceFolder?: string;
}

/**
 * Build final config: defaults ← user config ← project config ← CLI overrides.
 */
export function resolveConfig(overrides: CliOverrides = {}): PiDevcontainerConfig {
  const user = readUserConfig();
  const project = overrides.workspaceFolder
    ? readProjectConfig(overrides.workspaceFolder)
    : {};

  const config: PiDevcontainerConfig = {
    nodeVersion: project.nodeVersion ?? user.nodeVersion ?? DEFAULTS.nodeVersion,
    piVersion: project.piVersion ?? user.piVersion ?? DEFAULTS.piVersion,
    mode: overrides.mode ?? project.mode ?? user.mode ?? DEFAULTS.mode,
    writable: [
      ...new Set([
        ...(user.writable ?? DEFAULTS.writable),
        ...(project.writable ?? []),
        ...(overrides.writable ?? []),
      ]),
    ],
    extensions: overrides.noExtensions
      ? "skip"
      : (project.extensions ?? user.extensions ?? DEFAULTS.extensions),
    env: { ...(user.env ?? {}), ...(project.env ?? {}), ...(overrides.env ?? {}) },
    features: { ...(user.features ?? {}), ...(project.features ?? {}) },
    defaultImage: project.defaultImage ?? user.defaultImage ?? DEFAULTS.defaultImage,
  };

  return config;
}

/**
 * Resolve environment variables: null values get copied from host env.
 * Returns a record of key=value pairs (all resolved).
 */
export function resolveEnvVars(
  env: Record<string, string | null>
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === null) {
      // Copy from host
      const hostValue = process.env[key];
      if (hostValue !== undefined) {
        resolved[key] = hostValue;
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
