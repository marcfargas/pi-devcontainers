/**
 * Read and merge pi-devcontainers configuration.
 *
 * Config sources (precedence: CLI flags > user config > defaults):
 * 1. CLI flags (--mode, --writable, --env, etc.)
 * 2. ~/.pi/devcontainers.json (user preferences)
 * 3. Built-in defaults
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
  defaultImage: "mcr.microsoft.com/devcontainers/base:ubuntu",
};

/**
 * Read ~/.pi/devcontainers.json if it exists.
 */
function readUserConfig(): Partial<PiDevcontainerConfig> {
  const configPath = join(piConfigDir(), "devcontainers.json");
  if (!pathExists(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    // Strip JSON comments (// and /* */)
    const stripped = raw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return JSON.parse(stripped) as Partial<PiDevcontainerConfig>;
  } catch (err) {
    console.error(
      `Warning: Failed to parse ~/.pi/devcontainers.json: ${err instanceof Error ? err.message : err}`
    );
    return {};
  }
}

export interface CliOverrides {
  mode?: "holdpty" | "pi-server";
  writable?: string[];
  env?: Record<string, string | null>;
  rebuild?: boolean;
  noExtensions?: boolean;
}

/**
 * Build final config: defaults ← user config ← CLI overrides.
 */
export function resolveConfig(overrides: CliOverrides = {}): PiDevcontainerConfig {
  const user = readUserConfig();

  const config: PiDevcontainerConfig = {
    nodeVersion: user.nodeVersion ?? DEFAULTS.nodeVersion,
    piVersion: user.piVersion ?? DEFAULTS.piVersion,
    mode: overrides.mode ?? user.mode ?? DEFAULTS.mode,
    writable: [
      ...new Set([
        ...(user.writable ?? DEFAULTS.writable),
        ...(overrides.writable ?? []),
      ]),
    ],
    extensions: overrides.noExtensions
      ? "skip"
      : (user.extensions ?? DEFAULTS.extensions),
    env: { ...(user.env ?? {}), ...(overrides.env ?? {}) },
    defaultImage: user.defaultImage ?? DEFAULTS.defaultImage,
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
