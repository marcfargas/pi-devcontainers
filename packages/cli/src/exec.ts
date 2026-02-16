/**
 * Shell execution helpers for devcontainers CLI and Docker.
 *
 * Uses devcontainer CLI for `up` (image build + feature install),
 * but Docker directly for exec/stop/rm (no config file needed).
 */

import { execSync, spawn } from "node:child_process";
import { normalizePath } from "./paths.js";

// ─── devcontainer CLI ───────────────────────────────────────────────

/**
 * Check that devcontainers CLI is available.
 */
export function ensureDevcontainersCli(): void {
  try {
    execSync("npx @devcontainers/cli --version", {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
    });
  } catch {
    throw new Error(
      "devcontainers CLI not found. Install it with: npm install -g @devcontainers/cli"
    );
  }
}

export interface DevcontainerUpOptions {
  workspaceFolder: string;
  configPath: string;
  rebuild?: boolean;
  /** Show full devcontainer build output (--verbose flag) */
  verbose?: boolean;
}

/**
 * Run `devcontainer up` with the given config.
 * Returns the container ID.
 *
 * Build logs are captured and only shown on error.
 * A progress indicator shows the last meaningful line.
 */
export function devcontainerUp(opts: DevcontainerUpOptions): string {
  const args = [
    "@devcontainers/cli",
    "up",
    "--workspace-folder",
    opts.workspaceFolder,
    "--config",
    opts.configPath,
  ];

  if (opts.rebuild) {
    args.push("--remove-existing-container");
    args.push("--build-no-cache");
  }

  // Verbose mode: inherit stderr directly (all build logs visible)
  if (opts.verbose) {
    let result: string;
    try {
      result = execSync(`npx ${args.join(" ")}`, {
        encoding: "utf-8",
        timeout: 600000,
        stdio: ["pipe", "pipe", "inherit"],
      });
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string };
      result = execErr.stdout ?? "";
      if (!result) {
        throw new Error(
          `devcontainer up failed: ${execErr.stderr?.substring(0, 500) ?? "unknown error"}`
        );
      }
    }
    return parseDevcontainerUpResult(result);
  }

  // Quiet mode: capture everything, only show stderr on error
  let result: string;
  let stderrOutput = "";
  try {
    result = execSync(`npx ${args.join(" ")}`, {
      encoding: "utf-8",
      timeout: 600000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string };
    stderrOutput = execErr.stderr ?? "";
    result = execErr.stdout ?? "";
    if (!result) {
      const lastLines = stderrOutput.split("\n").filter(Boolean).slice(-20).join("\n");
      throw new Error(`devcontainer up failed:\n${lastLines}`);
    }
  }

  return parseDevcontainerUpResult(result);
}


function parseDevcontainerUpResult(result: string): string {
  try {
    const output = JSON.parse(result);
    if (output.containerId) {
      if (output.outcome !== "success") {
        console.warn(
          `  ⚠ Container started but postCreateCommand failed (non-fatal)`
        );
      }
      return output.containerId;
    }
    throw new Error(
      `devcontainer up failed: ${output.message || "no container ID in output"}`
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      const match = result.match(/"containerId":\s*"([^"]+)"/);
      if (match) return match[1];
      throw new Error(`devcontainer up returned unexpected output: ${result.substring(0, 200)}`);
    }
    throw err;
  }
}

// ─── Docker direct (for exec/stop/rm) ───────────────────────────────

/**
 * Check if a container is running.
 */
export function isContainerRunning(containerId: string): boolean {
  try {
    const result = execSync(
      `docker inspect --format "{{.State.Running}}" "${containerId}"`,
      { encoding: "utf-8", timeout: 10000, stdio: "pipe" }
    ).trim();
    return result === "true";
  } catch {
    return false;
  }
}

/**
 * Execute a command inside a running container (non-interactive, captured output).
 */
export function dockerExec(containerId: string, command: string[]): string {
  const escaped = command.map(c => `"${c.replace(/"/g, '\\"')}"`).join(" ");
  return execSync(
    `docker exec "${containerId}" ${escaped}`,
    {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "inherit"],
    }
  );
}

/**
 * Execute a command inside a running container (interactive, inherits stdio).
 * Returns a promise that resolves with the exit code.
 */
export function dockerExecInteractive(
  containerId: string,
  command: string[]
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", "-it", containerId, ...command],
      { stdio: "inherit" }
    );

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

/**
 * Stop and remove a container.
 */
export function dockerStopAndRemove(containerId: string): void {
  try {
    execSync(`docker stop "${containerId}"`, {
      timeout: 30000,
      stdio: "pipe",
    });
  } catch {
    // Container might already be stopped
  }
  try {
    execSync(`docker rm "${containerId}"`, {
      timeout: 15000,
      stdio: "pipe",
    });
  } catch {
    // Container might already be removed
  }
}

/**
 * Find containers by devcontainer label (fallback for state file).
 */
export function findContainersByLabel(workspaceFolder: string): string[] {
  try {
    const labelValue = normalizePath(workspaceFolder);
    const result = execSync(
      `docker ps -aq --filter "label=devcontainer.local_folder=${labelValue}"`,
      { encoding: "utf-8", timeout: 10000, stdio: "pipe" }
    ).trim();
    return result ? result.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}
