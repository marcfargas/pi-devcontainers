/**
 * `pi-devcontainers attach` — Attach to a running pi session.
 *
 * Uses `devcontainer exec --workspace-folder` so devcontainer runtime resolves
 * container/user/cwd/env from labels and metadata.
 */

import { normalizePath } from "../paths.js";
import {
  ensureDevcontainersCli,
  devcontainerExecInteractive,
} from "../exec.js";

export interface AttachOptions {
  workspaceFolder: string;
  sessionName?: string;
}

export async function commandAttach(opts: AttachOptions): Promise<void> {
  const workspaceFolder = normalizePath(opts.workspaceFolder);
  const sessionName = opts.sessionName ?? "pi";

  ensureDevcontainersCli();

  console.log(`🔗 Attaching to pi session "${sessionName}" in ${workspaceFolder}`);
  console.log("   (Detach: Ctrl+A then d)\n");

  const exitCode = await devcontainerExecInteractive(workspaceFolder, [
    "holdpty", "attach", sessionName,
  ]);

  if (exitCode !== 0) {
    console.error("\n⚠ Attach failed. If no container is running, start one with:");
    console.error(`   pidc up -w "${opts.workspaceFolder}"`);
    process.exitCode = exitCode;
  }
}
