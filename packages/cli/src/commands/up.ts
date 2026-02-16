/**
 * `pi-devcontainers up` — Launch a devcontainer with pi.
 *
 * 1. Read configs (user + project devcontainer.json)
 * 2. Resolve extensions/skills from pi settings
 * 3. Merge into a temp devcontainer.json (project config never modified)
 * 4. devcontainer up --workspace-folder <project> --config <temp>
 * 5. Launch pi via holdpty (using docker exec directly)
 * 6. Save state for attach/down
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type CliOverrides, resolveConfig, resolveEnvVars } from "../config.js";
import { mergeDevcontainerJson, type DevcontainerJson } from "../merge.js";
import { normalizePath, pathExists } from "../paths.js";
import { resolveSettingsForContainer } from "../extensions.js";
import {
  ensureDevcontainersCli,
  devcontainerUp,
  dockerExec,
  isContainerRunning,
} from "../exec.js";
import { saveContainer } from "../state.js";

const FEATURE_REF = "ghcr.io/marcfargas/devcontainer-features/pi:0";

export interface UpOptions extends CliOverrides {
  workspaceFolder: string;
  rebuild?: boolean;
}

/**
 * Find and read the project's devcontainer.json, if it exists.
 */
function readProjectDevcontainerJson(
  workspaceFolder: string
): DevcontainerJson | null {
  const candidates = [
    join(workspaceFolder, ".devcontainer", "devcontainer.json"),
    join(workspaceFolder, ".devcontainer.json"),
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf-8");
        const stripped = raw
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        return JSON.parse(stripped) as DevcontainerJson;
      } catch (err) {
        console.error(
          `Warning: Failed to parse ${candidate}: ${err instanceof Error ? err.message : err}`
        );
        return null;
      }
    }
  }

  return null;
}

export async function commandUp(opts: UpOptions): Promise<void> {
  const workspaceFolder = normalizePath(opts.workspaceFolder);

  console.log(`🚀 pi-devcontainers up: ${workspaceFolder}`);

  // 1. Ensure devcontainers CLI is available
  console.log("  ✓ Checking devcontainers CLI...");
  ensureDevcontainersCli();

  // 2. Resolve configuration
  console.log("  ✓ Reading configuration...");
  const config = resolveConfig(opts);
  const resolvedEnv = resolveEnvVars(config.env);

  // 3. Resolve extensions/skills from pi settings
  console.log("  ✓ Resolving extensions & skills...");
  const settingsResolution = config.extensions !== "skip"
    ? resolveSettingsForContainer(workspaceFolder)
    : { mounts: [], patchedSettingsPath: null };

  if (settingsResolution.mounts.length > 0) {
    for (const m of settingsResolution.mounts) {
      console.log(`    - ${m.containerPath}`);
    }
  } else {
    console.log("    (no extensions or skills to mount)");
  }

  // 4. Read project's devcontainer.json
  console.log("  ✓ Reading project devcontainer.json...");
  const projectConfig = readProjectDevcontainerJson(workspaceFolder);
  if (projectConfig) {
    console.log("    Found project devcontainer.json");
  } else {
    console.log(
      `    No devcontainer.json found, using default image: ${config.defaultImage}`
    );
  }

  // 5. Merge configs
  console.log("  ✓ Merging configuration...");

  const merged = mergeDevcontainerJson(
    projectConfig ?? {},
    config,
    resolvedEnv,
    {
      featureRef: FEATURE_REF,
      settingsMounts: settingsResolution.mounts,
      patchedSettingsPath: settingsResolution.patchedSettingsPath ?? undefined,
    }
  );

  // Write merged config to a temp directory
  const tempConfigDir = join(tmpdir(), `pidc-${Date.now()}`);
  mkdirSync(tempConfigDir, { recursive: true });
  const tempConfigPath = join(tempConfigDir, "devcontainer.json");
  writeFileSync(tempConfigPath, JSON.stringify(merged, null, 2));
  console.log(`  ✓ Wrote merged config: ${tempConfigPath}`);

  // 6. devcontainer up
  console.log("  ✓ Starting devcontainer...");
  const containerId = devcontainerUp({
    workspaceFolder,
    configPath: tempConfigPath,
    rebuild: opts.rebuild,
  });
  const shortId = containerId.substring(0, 12);
  console.log(`  ✓ Container started: ${shortId}`);

  // 7. Save state for attach/down/status
  saveContainer({
    containerId,
    workspaceFolder,
    configDir: tempConfigDir,
    settingsDir: settingsResolution.patchedSettingsPath
      ? join(settingsResolution.patchedSettingsPath, "..")
      : undefined,
    startedAt: new Date().toISOString(),
  });

  // 8. Launch pi via holdpty using docker exec
  if (config.mode === "holdpty") {
    console.log("  ✓ Launching pi via holdpty...");
    try {
      if (!isContainerRunning(containerId)) {
        throw new Error("Container is not running");
      }
      dockerExec(containerId, [
        "holdpty", "launch", "--bg", "--name", "pi", "--", "pi",
      ]);
      console.log("  ✓ Pi session started (holdpty)");
      console.log(
        `\n  Attach with: pidc attach -w "${opts.workspaceFolder}"`
      );
    } catch (err) {
      console.error(
        `  ⚠ Failed to launch pi via holdpty: ${err instanceof Error ? err.message : err}`
      );
      console.log(
        `  You can manually exec into the container:\n    docker exec -it ${shortId} pi`
      );
    }
  }

  console.log("\n✅ Done!");
}
