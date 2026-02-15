/**
 * `pi-devcontainers status` — List running pi devcontainers.
 */

import { execSync } from "node:child_process";

export async function commandStatus(): Promise<void> {
  console.log("📋 Pi devcontainers:\n");

  try {
    // Find containers with devcontainer labels
    const result = execSync(
      'docker ps --filter "label=devcontainer.local_folder" --format "{{.ID}}\t{{.Label \\"devcontainer.local_folder\\"}}\t{{.Status}}\t{{.CreatedAt}}"',
      { encoding: "utf-8", timeout: 10000 }
    ).trim();

    if (!result) {
      console.log("  (no running pi devcontainers)");
      return;
    }

    console.log("  ID            Workspace                    Status");
    console.log("  ─────────────────────────────────────────────────────");

    for (const line of result.split("\n")) {
      const [id, folder, status, created] = line.split("\t");
      console.log(`  ${id?.substring(0, 12)}  ${folder?.padEnd(28)}  ${status}`);
    }
  } catch (err) {
    console.error(
      `Failed to list containers: ${err instanceof Error ? err.message : err}`
    );
    process.exitCode = 1;
  }
}
