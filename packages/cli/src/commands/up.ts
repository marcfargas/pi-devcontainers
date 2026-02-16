/**
 * `pi-devcontainers up` — Launch a devcontainer with pi.
 *
 * 1. Read configs (user + project devcontainer.json)
 * 2. Resolve extensions/skills from pi settings
 * 3. Merge into a temp devcontainer.json (project config never modified)
 * 4. devcontainer up --workspace-folder <project> --config <temp>
 * 5. Launch pi via holdpty (devcontainer exec)
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { type CliOverrides, resolveConfig, resolveEnvVars } from "../config.js";
import { mergeDevcontainerJson, type DevcontainerJson } from "../merge.js";
import { normalizePath, pathExists } from "../paths.js";
import { resolveSettingsForContainer } from "../extensions.js";
import {
  ensureDevcontainersCli,
  devcontainerUp,
  devcontainerExec,
} from "../exec.js";

const FEATURE_REF = "ghcr.io/marcfargas/devcontainer-features/pi:0";

export interface UpOptions extends CliOverrides {
  workspaceFolder: string;
  rebuild?: boolean;
  verbose?: boolean;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function parseJsoncObject<T>(raw: string, label: string): T {
  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as T;

  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `${label}: ${printParseErrorCode(first.error)} at offset ${first.offset}`
    );
  }

  return parsed;
}

/** Find and read the project's devcontainer.json, if it exists. */
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
        return parseJsoncObject<DevcontainerJson>(raw, candidate);
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

  // 5. Determine candidate container homes.
  // Effective runtime user can differ from project devcontainer.json defaults.
  // Mount ~/.pi into common homes so pi can read host config whichever user
  // devcontainer exec resolves to.
  const configuredUser = (
    (projectConfig?.remoteUser as string | undefined)
    ?? (projectConfig?.containerUser as string | undefined)
    ?? (projectConfig?.user as string | undefined)
  );
  const primaryHome = configuredUser
    ? (configuredUser === "root" ? "/root" : `/home/${configuredUser}`)
    : "/root";
  const additionalHomes = ["/root", "/home/vscode", "/home/node"]
    .filter((home) => home !== primaryHome);

  // 6. Merge configs
  console.log("  ✓ Merging configuration...");
  const merged = mergeDevcontainerJson(
    projectConfig ?? {},
    config,
    resolvedEnv,
    {
      featureRef: FEATURE_REF,
      containerHome: primaryHome,
      additionalContainerHomes: additionalHomes,
      settingsMounts: settingsResolution.mounts,
      patchedSettingsPath: settingsResolution.patchedSettingsPath ?? undefined,
      workspaceFolderBasename: basename(workspaceFolder),
    }
  );

  const remoteWorkspaceFolder = typeof merged.workspaceFolder === "string"
    ? merged.workspaceFolder
    : `/workspaces/${basename(workspaceFolder)}`;

  // Write merged config to a temp directory
  const tempConfigDir = join(tmpdir(), `pidc-${Date.now()}`);
  mkdirSync(tempConfigDir, { recursive: true });
  const tempConfigPath = join(tempConfigDir, "devcontainer.json");
  writeFileSync(tempConfigPath, JSON.stringify(merged, null, 2));
  console.log(`  ✓ Wrote merged config: ${tempConfigPath}`);

  // 7. devcontainer up (config is only needed for this call)
  console.log("  ✓ Starting devcontainer...");
  try {
    devcontainerUp({
      workspaceFolder,
      configPath: tempConfigPath,
      rebuild: opts.rebuild,
      verbose: opts.verbose,
    });
  } finally {
    // Container is configured at creation time; remove temp config immediately.
    try {
      rmSync(tempConfigDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  console.log("  ✓ Container started");

  // 8. Launch pi via holdpty using devcontainer exec
  if (config.mode === "holdpty") {
    console.log("  ✓ Launching pi via holdpty...");
    try {
      devcontainerExec(workspaceFolder, [
        "bash",
        "-lc",
        `cd ${shQuote(remoteWorkspaceFolder)} && holdpty launch --bg --name pi -- pi`,
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
        `  You can manually exec into the container:\n    npx @devcontainers/cli exec --id-label "devcontainer.local_folder=${workspaceFolder}" -- pi`
      );
    }
  }

  console.log("\n✅ Done!");
}
