/**
 * `pi-devcontainers run` — up + attach + down in one command.
 *
 * Like `docker run`: starts the container, attaches interactively,
 * and tears down when the session ends.
 */

import { commandUp, type UpOptions } from "./up.js";
import { commandDown } from "./down.js";
import { normalizePath } from "../paths.js";
import { devcontainerExecInteractive } from "../exec.js";

export interface RunOptions extends UpOptions {
  sessionName?: string;
}

export async function commandRun(opts: RunOptions): Promise<void> {
  const workspaceFolder = normalizePath(opts.workspaceFolder);
  const sessionName = opts.sessionName ?? "pi";

  // 1. Up
  await commandUp(opts);

  // 2. Attach
  console.log(`\n🔗 Attaching to pi session "${sessionName}"...`);
  console.log("   (Detach: Ctrl+A then d | Session end triggers cleanup)\n");

  let exitCode = 0;
  try {
    exitCode = await devcontainerExecInteractive(workspaceFolder, [
      "holdpty", "attach", sessionName,
    ]);
  } finally {
    // 3. Down
    console.log("\n🛑 Session ended — cleaning up...");
    await commandDown({ workspaceFolder: opts.workspaceFolder });
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}
