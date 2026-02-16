/**
 * `pi-devcontainers status` — List devcontainers discovered by label.
 */

import { listLabeledDevcontainers } from "../exec.js";

export async function commandStatus(): Promise<void> {
  console.log("📋 Pi devcontainers:\n");

  const containers = listLabeledDevcontainers();

  if (containers.length === 0) {
    console.log("  (no devcontainers found)");
    return;
  }

  console.log(
    "  ID            Status                     Workspace"
  );
  console.log(
    "  ──────────────────────────────────────────────────────────────────────"
  );

  for (const c of containers) {
    const shortId = c.containerId.substring(0, 12);
    const running = c.status.toLowerCase().startsWith("up ");
    const icon = running ? "🟢" : "⚫";
    console.log(`  ${shortId}  ${icon} ${c.status.padEnd(24)}  ${c.workspaceFolder}`);
  }
}
