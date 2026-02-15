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
 *
 * Strategy: layered mounts.
 * 1. RO bind mount of host ~/.pi → container user's ~/.pi (config, skills, etc.)
 * 2. Writable volume overlays on top for dirs that need writes (todos, memoria)
 *
 * The remoteUser's home is typically /home/vscode for devcontainer base images.
 * We use remoteEnv to set PI_USER_HOME so setup.sh can find the right path.
 */
function piMounts(
  config: PiDevcontainerConfig,
  containerHome: string
): MountObject[] {
  const piDir = piConfigDir();
  const containerPiDir = `${containerHome}/.pi`;

  const mounts: MountObject[] = [
    // RO bind mount: host ~/.pi → container ~/.pi
    {
      type: "bind",
      source: dockerMountPath(piDir),
      target: containerPiDir,
      readonly: "true",
    },
  ];

  // Writable volume overlays on top of the RO bind mount
  for (const dir of config.writable) {
    mounts.push({
      type: "volume",
      source: `pi-${dir.replace(/\//g, "-")}`,
      target: `${containerPiDir}/${dir}`,
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
    /** Container user's home directory (default: /home/vscode) */
    containerHome?: string;
  }
): DevcontainerJson {
  const merged: DevcontainerJson = { ...project };
  const containerHome = options?.containerHome ?? "/home/vscode";

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

  // Append mounts — layered: RO bind for ~/.pi, writable volumes on top
  const existingMounts = merged.mounts ?? [];
  const newMounts = piMounts(config, containerHome);

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

  // Only chain postCreateCommand if there are extensions to install
  // Config copy is handled by layered mounts — no setup.sh needed for that
  if (options?.extensionStagingDir) {
    merged.postCreateCommand = chainPostCreateCommand(
      merged.postCreateCommand,
      PI_SETUP_SCRIPT
    );
  }

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
