/**
 * `pi-devcontainers down` — Stop and remove the devcontainer.
 *
 * Uses docker stop/rm directly, looking up container ID from state file.
 * Cleans up temp dirs (merged config, patched settings).
 */

import { rmSync } from "node:fs";
import { normalizePath } from "../paths.js";
import { getContainer, removeContainer } from "../state.js";
import {
  dockerStopAndRemove,
  isContainerRunning,
  findContainersByLabel,
} from "../exec.js";

export interface DownOptions {
  workspaceFolder: string;
}

export async function commandDown(opts: DownOptions): Promise<void> {
  const workspaceFolder = normalizePath(opts.workspaceFolder);

  console.log(`🛑 Stopping devcontainer: ${workspaceFolder}`);

  // Find the container
  const state = getContainer(workspaceFolder);
  let containerId: string | null = state?.containerId ?? null;

  // Fallback: find by Docker label
  if (!containerId) {
    const ids = findContainersByLabel(workspaceFolder);
    if (ids.length > 0) {
      containerId = ids[0];
    }
  }

  if (!containerId) {
    console.log("  No running devcontainer found.");
    removeContainer(workspaceFolder); // clean up stale state
    return;
  }

  const shortId = containerId.substring(0, 12);

  // Stop and remove
  if (isContainerRunning(containerId)) {
    console.log(`  Stopping container ${shortId}...`);
  }
  dockerStopAndRemove(containerId);
  console.log(`  ✓ Container ${shortId} stopped and removed.`);

  // Clean up temp dirs
  if (state?.configDir) {
    try {
      rmSync(state.configDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
  if (state?.settingsDir) {
    try {
      rmSync(state.settingsDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  // Remove from state file
  removeContainer(workspaceFolder);

  console.log("✅ Done.");
}
