/**
 * `pi-devcontainers status` — List running pi devcontainers.
 *
 * Shows containers from the state file, cross-referenced with Docker
 * to show actual running status.
 */

import { listContainers, removeContainer } from "../state.js";
import { isContainerRunning } from "../exec.js";

export async function commandStatus(): Promise<void> {
  console.log("📋 Pi devcontainers:\n");

  const containers = listContainers();

  if (containers.length === 0) {
    console.log("  (no tracked pi devcontainers)");
    return;
  }

  console.log(
    "  ID            Status     Started              Workspace"
  );
  console.log(
    "  ──────────────────────────────────────────────────────────────────────"
  );

  for (const c of containers) {
    const shortId = c.containerId.substring(0, 12);
    const running = isContainerRunning(c.containerId);
    const status = running ? "🟢 running" : "⚫ stopped";
    const started = c.startedAt
      ? new Date(c.startedAt).toLocaleString()
      : "unknown";

    console.log(`  ${shortId}  ${status}  ${started.padEnd(20)}  ${c.workspaceFolder}`);

    // Clean up stale entries
    if (!running) {
      removeContainer(c.workspaceFolder);
    }
  }
}
