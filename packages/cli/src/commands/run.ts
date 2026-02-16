/**
 * `pi-devcontainers run` — up + attach + down in one command.
 *
 * Like `docker run`: starts the container, attaches interactively,
 * and tears down when the session ends.
 */

import { commandUp, type UpOptions } from "./up.js";
import { commandDown } from "./down.js";
import { normalizePath } from "../paths.js";
import { getContainer } from "../state.js";
import { dockerExecInteractive, isContainerRunning } from "../exec.js";

export interface RunOptions extends UpOptions {
  sessionName?: string;
}

export async function commandRun(opts: RunOptions): Promise<void> {
  const workspaceFolder = normalizePath(opts.workspaceFolder);
  const sessionName = opts.sessionName ?? "pi";

  // 1. Up
  await commandUp(opts);

  // 2. Attach
  const state = getContainer(workspaceFolder);
  if (!state || !isContainerRunning(state.containerId)) {
    console.error("❌ Container failed to start — skipping attach.");
    process.exitCode = 1;
    return;
  }

  console.log(`\n🔗 Attaching to pi session "${sessionName}"...`);
  console.log("   (Detach: Ctrl+A then d | Session end triggers cleanup)\n");

  const exitCode = await dockerExecInteractive(state.containerId, [
    "holdpty", "attach", sessionName,
  ], {
    user: state.remoteUser,
    workdir: state.remoteWorkspaceFolder,
  });

  // 3. Down
  console.log("\n🛑 Session ended — cleaning up...");
  await commandDown({ workspaceFolder: opts.workspaceFolder });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
