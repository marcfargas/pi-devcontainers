/**
 * `pi-devcontainers down` — Stop and remove the devcontainer.
 */

import { normalizePath } from "../paths.js";
import { devcontainerDown } from "../exec.js";

export interface DownOptions {
  workspaceFolder: string;
}

export async function commandDown(opts: DownOptions): Promise<void> {
  const workspaceFolder = normalizePath(opts.workspaceFolder);

  console.log(`🛑 Stopping devcontainer: ${workspaceFolder}`);

  try {
    devcontainerDown(workspaceFolder);
    console.log("✅ Container stopped and removed.");
  } catch (err) {
    console.error(
      `❌ Failed to stop container: ${err instanceof Error ? err.message : err}`
    );
    process.exitCode = 1;
  }
}
