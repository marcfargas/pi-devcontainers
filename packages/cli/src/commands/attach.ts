/**
 * `pi-devcontainers attach` — Attach to a running pi session.
 */

import { normalizePath } from "../paths.js";
import { devcontainerExecInteractive } from "../exec.js";

export interface AttachOptions {
  workspaceFolder: string;
  sessionName?: string;
}

export async function commandAttach(opts: AttachOptions): Promise<void> {
  const workspaceFolder = normalizePath(opts.workspaceFolder);
  const sessionName = opts.sessionName ?? "pi";

  console.log(`🔗 Attaching to pi session "${sessionName}" in ${workspaceFolder}`);
  console.log("   (Detach: Ctrl+A then d)\n");

  const exitCode = await devcontainerExecInteractive(workspaceFolder, [
    "holdpty",
    "attach",
    sessionName,
  ]);

  if (exitCode !== 0) {
    console.error(`\n⚠ Session exited with code ${exitCode}`);
    process.exitCode = exitCode;
  }
}
