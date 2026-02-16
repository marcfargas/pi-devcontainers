/**
 * `pi-devcontainers attach` — Attach to a running pi session.
 *
 * Uses docker exec directly (no devcontainer CLI needed),
 * looking up the container ID from the state file.
 */

import { normalizePath } from "../paths.js";
import { getContainer } from "../state.js";
import { dockerExecInteractive, isContainerRunning, findContainersByLabel } from "../exec.js";

export interface AttachOptions {
  workspaceFolder: string;
  sessionName?: string;
}

export async function commandAttach(opts: AttachOptions): Promise<void> {
  const workspaceFolder = normalizePath(opts.workspaceFolder);
  const sessionName = opts.sessionName ?? "pi";

  // Find the container
  let containerId: string | null = null;

  // 1. Try state file
  const state = getContainer(workspaceFolder);
  if (state) {
    containerId = state.containerId;
  }

  // 2. Fallback: find by Docker label
  if (!containerId) {
    const ids = findContainersByLabel(workspaceFolder);
    if (ids.length > 0) {
      containerId = ids[0];
    }
  }

  if (!containerId) {
    console.error(`❌ No devcontainer found for ${workspaceFolder}`);
    console.error(`   Start one with: pidc up -w "${opts.workspaceFolder}"`);
    process.exitCode = 1;
    return;
  }

  if (!isContainerRunning(containerId)) {
    console.error(`❌ Container ${containerId.substring(0, 12)} is not running.`);
    console.error(`   Start it with: pidc up -w "${opts.workspaceFolder}"`);
    process.exitCode = 1;
    return;
  }

  const remoteUser = state?.remoteUser;

  console.log(`🔗 Attaching to pi session "${sessionName}" in ${workspaceFolder}`);
  console.log("   (Detach: Ctrl+A then d)\n");

  const exitCode = await dockerExecInteractive(containerId, [
    "holdpty", "attach", sessionName,
  ], remoteUser);

  if (exitCode !== 0) {
    console.error(`\n⚠ Session exited with code ${exitCode}`);
    process.exitCode = exitCode;
  }
}
