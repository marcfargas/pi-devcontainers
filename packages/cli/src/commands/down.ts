/**
 * `pi-devcontainers down` — Stop and remove the devcontainer.
 *
 * Uses Docker stop/rm directly, resolving container IDs by
 * devcontainer workspace label.
 */

import { normalizePath } from "../paths.js";
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

  const containerIds = findContainersByLabel(workspaceFolder);

  if (containerIds.length === 0) {
    console.log("  No devcontainer found.");
    return;
  }

  for (const containerId of containerIds) {
    const shortId = containerId.substring(0, 12);
    if (isContainerRunning(containerId)) {
      console.log(`  Stopping container ${shortId}...`);
    }
    dockerStopAndRemove(containerId);
    console.log(`  ✓ Container ${shortId} stopped and removed.`);
  }

  console.log("✅ Done.");
}
