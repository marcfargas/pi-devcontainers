/**
 * `pi-devcontainers up` — Launch a devcontainer with pi.
 *
 * 1. Read configs (user + project)
 * 2. Pack linked extensions (if configured)
 * 3. Merge devcontainer.json
 * 4. Write temp config
 * 5. devcontainer up --config <temp>
 * 6. Launch pi via holdpty
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { type CliOverrides, resolveConfig, resolveEnvVars } from "../config.js";
import { mergeDevcontainerJson, type DevcontainerJson } from "../merge.js";
import { normalizePath, pathExists } from "../paths.js";
import { packLinkedExtensions } from "../extensions.js";
import {
  ensureDevcontainersCli,
  devcontainerUp,
  devcontainerExec,
} from "../exec.js";

/**
 * Resolve where the feature source is.
 * In development (running from source), use local feature directory.
 * In production (installed via npm), use GHCR reference.
 */
function resolveFeatureRef(): {
  type: "local" | "ghcr";
  ref: string;
  path?: string;
} {
  // Check if packages/feature exists relative to this file (monorepo dev)
  // In dev: src/commands/up.ts → ../../.. → packages/cli → ../feature
  // In dist: dist/commands/up.js → ../../.. → packages/cli → ../feature
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const cliPkgRoot = join(thisDir, "..", "..");
  const localFeature = join(cliPkgRoot, "..", "feature");
  if (existsSync(join(localFeature, "devcontainer-feature.json"))) {
    return { type: "local", ref: "./pi-feature", path: localFeature };
  }

  // Production: use GHCR
  return {
    type: "ghcr",
    ref: "ghcr.io/marcfargas/devcontainer-features/pi:latest",
  };
}

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
        // Strip JSON comments
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

  // 3. Pack linked extensions if configured
  let extensionStagingDir: string | undefined;
  if (config.extensions === "pack") {
    console.log("  ✓ Packing linked extensions...");
    const { stagingDir, extensions } = packLinkedExtensions(workspaceFolder);
    if (extensions.length > 0) {
      extensionStagingDir = stagingDir;
      for (const ext of extensions) {
        const status = ext.cached ? "(cached)" : "(packed)";
        console.log(`    - ${ext.name} ${status}`);
      }
    } else {
      console.log("    (no linked extensions found)");
    }
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

  // 5. Resolve feature source — local (dev) or GHCR (published)
  const featureRef = resolveFeatureRef();
  console.log(`  ✓ Feature: ${featureRef.type === "local" ? "local" : featureRef.ref}`);

  // 6. Merge configs
  console.log("  ✓ Merging configuration...");

  // Build temp .devcontainer/ structure (required by devcontainer CLI for local features)
  const tempDir = join(tmpdir(), `pi-devcontainer-${Date.now()}`);
  const tempDevcontainerDir = join(tempDir, ".devcontainer");
  mkdirSync(tempDevcontainerDir, { recursive: true });

  // If local feature, copy it into the temp .devcontainer/ so relative path resolves
  let mergeFeatureRef = featureRef.ref;
  if (featureRef.type === "local") {
    const destFeatureDir = join(tempDevcontainerDir, "pi-feature");
    cpSync(featureRef.path!, destFeatureDir, { recursive: true });
    mergeFeatureRef = "./pi-feature";
  }

  const merged = mergeDevcontainerJson(
    projectConfig ?? {},
    config,
    resolvedEnv,
    {
      featureRef: mergeFeatureRef,
      extensionStagingDir,
    }
  );

  const tempConfigPath = join(tempDevcontainerDir, "devcontainer.json");
  writeFileSync(tempConfigPath, JSON.stringify(merged, null, 2));
  console.log(`  ✓ Wrote merged config: ${tempConfigPath}`);

  // 7. Run devcontainer up
  console.log("  ✓ Starting devcontainer...");
  const containerId = devcontainerUp({
    workspaceFolder,
    configPath: tempConfigPath,
    rebuild: opts.rebuild,
  });
  console.log(`  ✓ Container started: ${containerId.substring(0, 12)}`);

  // 8. Launch pi via holdpty inside the container
  if (config.mode === "holdpty") {
    console.log("  ✓ Launching pi via holdpty...");
    try {
      devcontainerExec({
        workspaceFolder,
        command: [
          "holdpty",
          "launch",
          "--bg",
          "--name",
          "pi",
          "--",
          "pi",
        ],
      });
      console.log("  ✓ Pi session started (holdpty)");
      console.log(
        `\n  Attach with: npx pi-devcontainers attach --workspace-folder "${opts.workspaceFolder}"`
      );
    } catch (err) {
      console.error(
        `  ⚠ Failed to launch pi via holdpty: ${err instanceof Error ? err.message : err}`
      );
      console.log(
        `  You can manually exec into the container:\n  npx @devcontainers/cli exec --workspace-folder "${opts.workspaceFolder}" pi`
      );
    }
  }

  console.log("\n✅ Done!");
}
