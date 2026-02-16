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
export function devcontainerUp(opts: DevcontainerUpOptions): DevcontainerUpResult {
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


export interface DevcontainerUpResult {
  containerId: string;
  remoteWorkspaceFolder?: string;
}

function parseDevcontainerUpResult(result: string): DevcontainerUpResult {
  try {
    const output = JSON.parse(result);
    if (output.containerId) {
      if (output.outcome !== "success") {
        console.warn(
          `  ⚠ Container started but postCreateCommand failed (non-fatal)`
        );
      }
      return {
        containerId: output.containerId,
        remoteWorkspaceFolder: output.remoteWorkspaceFolder,
      };
    }
    throw new Error(
      `devcontainer up failed: ${output.message || "no container ID in output"}`
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      const match = result.match(/"containerId":\s*"([^"]+)"/);
      if (match) return { containerId: match[1] };
      throw new Error(`devcontainer up returned unexpected output: ${result.substring(0, 200)}`);
    }
    throw err;
  }
}

// ─── Docker direct (for exec/stop/rm) ───────────────────────────────

/** Env vars to inject into every docker exec for proper TUI rendering. */
const DOCKER_EXEC_ENV = [
  "-e", "TERM=xterm-256color",
  "-e", "COLORTERM=truecolor",
  "-e", "LANG=C.UTF-8",
];

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
 * If user is specified, runs as that user; otherwise uses the container's default.
 */
export function dockerExec(
  containerId: string,
  command: string[],
  opts?: { user?: string; workdir?: string },
): string {
  const args = ["exec", ...DOCKER_EXEC_ENV];
  if (opts?.user) args.push("-u", opts.user);
  if (opts?.workdir) args.push("-w", opts.workdir);
  args.push(containerId, ...command);
  return execSync(
    `docker ${args.map(a => `"${a}"`).join(" ")}`,
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
  command: string[],
  opts?: { user?: string; workdir?: string },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = ["exec", "-it", ...DOCKER_EXEC_ENV];
    if (opts?.user) args.push("-u", opts.user);
    if (opts?.workdir) args.push("-w", opts.workdir);
    args.push(containerId, ...command);

    const child = spawn("docker", args, { stdio: "inherit" });

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
