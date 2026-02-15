/**
 * Merge a project's devcontainer.json with pi's requirements.
 *
 * Strategy: ADDITIVE ONLY.
 * - features: add pi feature
 * - mounts: append pi mounts
 * - remoteEnv: merge (pi vars don't overwrite project vars)
 * - postCreateCommand: chain with pi setup
 * - Everything else: untouched
 */

import type { PiDevcontainerConfig } from "./config.js";
import { dockerMountPath, piConfigDir } from "./paths.js";

/** Raw devcontainer.json structure (partial — only what we touch). */
export interface DevcontainerJson {
  image?: string;
  build?: Record<string, unknown>;
  features?: Record<string, Record<string, unknown>>;
  mounts?: (string | MountObject)[];
  remoteEnv?: Record<string, string>;
  postCreateCommand?: string | string[] | Record<string, string | string[]>;
  [key: string]: unknown;
}

interface MountObject {
  type: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

const PI_SETUP_SCRIPT = "/opt/pi/setup.sh";

/**
 * Generate the pi feature entry for the features object.
 */
function piFeatureEntry(config: PiDevcontainerConfig): Record<string, unknown> {
  return {
    nodeVersion: config.nodeVersion,
    piVersion: config.piVersion,
  };
}

/**
 * Generate mounts for pi's needs.
 */
function piMounts(config: PiDevcontainerConfig): MountObject[] {
  const piDir = piConfigDir();
  const mounts: MountObject[] = [
    // RO bind mount for ~/.pi base config
    {
      type: "bind",
      source: dockerMountPath(piDir),
      target: "/opt/pi-host-config",
      readonly: "true",
    },
  ];

  // Writable Docker volumes for configured dirs
  for (const dir of config.writable) {
    mounts.push({
      type: "volume",
      source: `pi-${dir.replace(/\//g, "-")}`,
      target: `/home/node/.pi/${dir}`,
    });
  }

  return mounts;
}

/**
 * Chain a new command with an existing postCreateCommand.
 * Handles all three formats: string, array, object.
 */
export function chainPostCreateCommand(
  existing: DevcontainerJson["postCreateCommand"],
  newCommand: string
): DevcontainerJson["postCreateCommand"] {
  if (existing === undefined || existing === null) {
    return newCommand;
  }

  if (typeof existing === "string") {
    // String: chain with &&
    return `${existing} && ${newCommand}`;
  }

  if (Array.isArray(existing)) {
    // Array: append (each element is a separate command arg, we add a new shell command)
    // Arrays in devcontainer.json are executed as a single command with args,
    // so we convert to object format for independent commands
    return {
      "project-setup": existing,
      "pi-setup": newCommand,
    };
  }

  if (typeof existing === "object") {
    // Object: add a new key
    return {
      ...existing,
      "pi-setup": newCommand,
    };
  }

  // Fallback: just use the new command
  return newCommand;
}

/**
 * Merge a project's devcontainer.json with pi requirements.
 * Returns a new object — never mutates the input.
 */
export function mergeDevcontainerJson(
  project: DevcontainerJson,
  config: PiDevcontainerConfig,
  resolvedEnv: Record<string, string>,
  options?: {
    /** Feature reference (e.g., local path or ghcr.io/...) */
    featureRef?: string;
    /** Path to extension tarballs staging dir (mount source) */
    extensionStagingDir?: string;
  }
): DevcontainerJson {
  const merged: DevcontainerJson = { ...project };

  // If no image or build, add default image
  if (!merged.image && !merged.build) {
    merged.image = config.defaultImage;
  }

  // Add pi feature
  const featureKey =
    options?.featureRef ?? "ghcr.io/marcfargas/pi-devcontainer-feature:latest";
  merged.features = {
    ...(merged.features ?? {}),
    [featureKey]: piFeatureEntry(config),
  };

  // Append mounts
  const existingMounts = merged.mounts ?? [];
  const newMounts = piMounts(config);

  // Add extension staging mount if provided
  if (options?.extensionStagingDir) {
    newMounts.push({
      type: "bind",
      source: dockerMountPath(options.extensionStagingDir),
      target: "/opt/pi-ext-staging",
      readonly: "true",
    });
  }

  merged.mounts = [...existingMounts, ...newMounts];

  // Merge remoteEnv (pi vars don't overwrite project vars)
  const existingEnv = merged.remoteEnv ?? {};
  merged.remoteEnv = { ...resolvedEnv, ...existingEnv };

  // Chain postCreateCommand
  merged.postCreateCommand = chainPostCreateCommand(
    merged.postCreateCommand,
    PI_SETUP_SCRIPT
  );

  return merged;
}

/**
 * Generate a minimal devcontainer.json for projects that have none.
 */
export function generateMinimalDevcontainerJson(
  config: PiDevcontainerConfig,
  resolvedEnv: Record<string, string>,
  options?: {
    featureRef?: string;
    extensionStagingDir?: string;
  }
): DevcontainerJson {
  return mergeDevcontainerJson({}, config, resolvedEnv, options);
}
