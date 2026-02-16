/**
 * Merge a project's devcontainer.json with pi's requirements.
 *
 * Strategy: ADDITIVE ONLY.
 * - features: add pi feature
 * - mounts: append pi mounts
 * - remoteEnv: merge (pi vars don't overwrite project vars)
 * - postCreateCommand: chain symlink fixup on Windows
 * - Everything else: untouched
 */

import type { PiDevcontainerConfig } from "./config.js";
import type { PiSettingsMount } from "./extensions.js";
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
 * 1. RO bind mount of host ~/.pi → container ~/.pi
 * 2. Writable overlays on top for dirs that need writes (todos, memoria)
 *
 * We can mount into multiple home paths because runtime user may differ from
 * project devcontainer.json (e.g. `node`, `vscode`, `root`).
 */
function piMounts(
  config: PiDevcontainerConfig,
  containerHomes: string[]
): MountObject[] {
  const piDir = piConfigDir();
  const homes = Array.from(new Set(containerHomes.filter(Boolean)));

  const mounts: MountObject[] = [];

  for (const home of homes) {
    const containerPiDir = `${home}/.pi`;

    // RO bind mount: host ~/.pi → container ~/.pi
    mounts.push({
      type: "bind",
      source: dockerMountPath(piDir),
      target: containerPiDir,
      readonly: "true",
    });

    // Writable bind mount overlays on top of the RO bind mount.
    for (const dir of config.writable) {
      mounts.push({
        type: "bind",
        source: dockerMountPath(`${piDir}/${dir}`),
        target: `${containerPiDir}/${dir}`,
      });
    }
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
    /** Primary container home directory (default: /root) */
    containerHome?: string;
    /** Additional candidate container home directories */
    additionalContainerHomes?: string[];
    /** Extension/skill source mounts (RO bind mounts at same path) */
    settingsMounts?: PiSettingsMount[];
    /** Path to patched settings.json (single-file bind mount over original) */
    patchedSettingsPath?: string;
    /** Workspace folder name (basename) — used to set explicit remoteWorkspaceFolder */
    workspaceFolderBasename?: string;
  }
): DevcontainerJson {
  const merged: DevcontainerJson = { ...project };
  const containerHome = options?.containerHome ?? "/root";
  const containerHomes = Array.from(new Set([
    containerHome,
    ...(options?.additionalContainerHomes ?? []),
  ]));

  // If no image or build, add default image
  if (!merged.image && !merged.build) {
    merged.image = config.defaultImage;
  }

  // Ensure workspaceFolder is always explicit in the merged config.
  // When using --config from a temp directory, the devcontainer CLI may not
  // correctly infer the remote workspace path, causing postCreateCommand
  // and other lifecycle hooks to run with the wrong CWD.
  if (!merged.workspaceFolder && options?.workspaceFolderBasename) {
    merged.workspaceFolder = `/workspaces/${options.workspaceFolderBasename}`;
  }

  // Add pi feature + any additional features from config
  const featureKey =
    options?.featureRef ?? "ghcr.io/marcfargas/pi-devcontainer-feature:latest";
  merged.features = {
    ...(merged.features ?? {}),
    ...(config.features ?? {}),
    [featureKey]: piFeatureEntry(config),
  };

  // Append mounts — layered: RO bind for ~/.pi, writable volumes on top
  const existingMounts = merged.mounts ?? [];
  const newMounts = piMounts(config, containerHomes);

  // Mount each extension/skill source dir at the same POSIX path (RO)
  if (options?.settingsMounts) {
    for (const m of options.settingsMounts) {
      newMounts.push({
        type: "bind",
        source: dockerMountPath(m.hostPath),
        target: m.containerPath,
        readonly: "true",
      });
    }
  }

  // Mount patched settings.json over the original (single-file bind mount)
  if (options?.patchedSettingsPath) {
    for (const home of containerHomes) {
      const containerPiDir = `${home}/.pi`;
      newMounts.push({
        type: "bind",
        source: dockerMountPath(options.patchedSettingsPath),
        target: `${containerPiDir}/agent/settings.json`,
      });
    }
  }

  merged.mounts = [...existingMounts, ...newMounts];

  // Merge remoteEnv (pi vars don't overwrite project vars)
  // Ensure terminal/locale env vars are set for proper TUI rendering
  const piEnv: Record<string, string> = {
    PI_DEVCONTAINER: "1",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "C.UTF-8",
    ...resolvedEnv,
  };
  const existingEnv = merged.remoteEnv ?? {};
  merged.remoteEnv = { ...piEnv, ...existingEnv };

  // On Windows, Docker Desktop rewrites bind-mount symlink targets with a
  // /mnt/host/ prefix (e.g. /c/dev/foo → /mnt/host/c/dev/foo). These paths
  // don't resolve inside the container. Add a postCreateCommand to create a
  // symlink so /mnt/host/c → /c (and any other drive letters we use).
  if (process.platform === "win32") {
    const drives = new Set<string>();
    for (const mount of merged.mounts ?? []) {
      const target = typeof mount === "string" ? "" : mount.target;
      const match = target.match(/^\/([a-z])\//);
      if (match) drives.add(match[1]);
    }
    if (drives.size > 0) {
      const cmds = [
        "sudo mkdir -p /mnt/host",
        ...Array.from(drives).map(d => `sudo ln -sfn /${d} /mnt/host/${d}`),
      ];
      merged.postCreateCommand = chainPostCreateCommand(
        merged.postCreateCommand,
        cmds.join(" && "),
      );
    }
  }

  return merged;
}

