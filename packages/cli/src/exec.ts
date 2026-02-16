/**
 * Shell execution helpers for devcontainers CLI and Docker.
 *
 * Runtime behavior (exec/user/cwd/env) is delegated to devcontainer CLI.
 * Docker is only used for stop/rm and simple label-based discovery.
 */

import { execFileSync, execSync, spawn } from "node:child_process";
import { normalizePath } from "./paths.js";

// On Windows, `devcontainer`/`npx` are often .cmd wrappers; need shell mode.
const IS_WIN = process.platform === "win32";

/**
 * Quote an argument for safe embedding in a cmd.exe command string.
 * Characters known safe for bare use pass through; everything else
 * gets wrapped in double quotes with internal `"` escaped as `""`.
 */
function winQuote(arg: string): string {
  if (/^[a-zA-Z0-9_./:=@\\-]+$/.test(arg)) return arg;
  return '"' + arg.replace(/"/g, '""') + '"';
}

/**
 * Build a properly quoted command string for cmd.exe.
 * Fixes Node DEP0190: execFileSync with shell:true concatenates args
 * without escaping, breaking commands that contain spaces, &&, $, etc.
 */
function buildWinCmd(bin: string, args: string[]): string {
  return [bin, ...args].map(winQuote).join(" ");
}

// ─── devcontainer CLI ───────────────────────────────────────────────

type DevcontainerRunner = "devcontainer" | "npx";
let cachedRunner: DevcontainerRunner | null = null;

function detectDevcontainersRunner(): DevcontainerRunner {
  if (cachedRunner) return cachedRunner;

  // Prefer globally installed `devcontainer` binary when available.
  try {
    if (IS_WIN) {
      execSync(buildWinCmd("devcontainer", ["--version"]), {
        encoding: "utf-8", timeout: 15000, stdio: "pipe",
      });
    } else {
      execFileSync("devcontainer", ["--version"], {
        encoding: "utf-8", timeout: 15000, stdio: "pipe",
      });
    }
    cachedRunner = "devcontainer";
    return cachedRunner;
  } catch {
    // fallback to npx package runner
  }

  try {
    if (IS_WIN) {
      execSync(buildWinCmd("npx", ["@devcontainers/cli", "--version"]), {
        encoding: "utf-8", timeout: 15000, stdio: "pipe",
      });
    } else {
      execFileSync("npx", ["@devcontainers/cli", "--version"], {
        encoding: "utf-8", timeout: 15000, stdio: "pipe",
      });
    }
    cachedRunner = "npx";
    return cachedRunner;
  } catch {
    throw new Error(
      "devcontainers CLI not found. Install `devcontainer` CLI or @devcontainers/cli (npx)."
    );
  }
}

function devcontainerInvocation(args: string[]): { bin: string; args: string[] } {
  const runner = detectDevcontainersRunner();
  if (runner === "devcontainer") {
    return { bin: "devcontainer", args };
  }
  return { bin: "npx", args: ["@devcontainers/cli", ...args] };
}

function workspaceIdLabel(workspaceFolder: string): string {
  return `devcontainer.local_folder=${normalizePath(workspaceFolder)}`;
}

/** Check that devcontainers CLI is available. */
export function ensureDevcontainersCli(): void {
  detectDevcontainersRunner();
}

export interface DevcontainerUpOptions {
  workspaceFolder: string;
  configPath: string;
  rebuild?: boolean;
  /** Show full devcontainer build output (--verbose flag) */
  verbose?: boolean;
}

/** Run `devcontainer up` with the given config. */
export function devcontainerUp(opts: DevcontainerUpOptions): void {
  const cliArgs = [
    "up",
    "--workspace-folder",
    opts.workspaceFolder,
    "--id-label",
    workspaceIdLabel(opts.workspaceFolder),
    "--config",
    opts.configPath,
  ];

  if (opts.rebuild) {
    cliArgs.push("--remove-existing-container");
    cliArgs.push("--build-no-cache");
  }

  const invocation = devcontainerInvocation(cliArgs);

  if (opts.verbose) {
    if (IS_WIN) {
      execSync(buildWinCmd(invocation.bin, invocation.args), {
        encoding: "utf-8", timeout: 600000, stdio: "inherit",
      });
    } else {
      execFileSync(invocation.bin, invocation.args, {
        encoding: "utf-8", timeout: 600000, stdio: "inherit",
      });
    }
    return;
  }

  try {
    if (IS_WIN) {
      execSync(buildWinCmd(invocation.bin, invocation.args), {
        encoding: "utf-8", timeout: 600000, stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      execFileSync(invocation.bin, invocation.args, {
        encoding: "utf-8", timeout: 600000, stdio: ["pipe", "pipe", "pipe"],
      });
    }
  } catch (err: unknown) {
    const execErr = err as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };

    const stdout = String(execErr.stdout ?? "");
    const stderr = String(execErr.stderr ?? "");

    // devcontainer up can fail due to postCreateCommand while the container
    // still starts. If we got a containerId in stdout JSON, continue.
    if (/"containerId"\s*:\s*"[^"]+"/.test(stdout)) {
      console.warn("  ⚠ Container started but postCreateCommand failed (non-fatal)");
      return;
    }

    const lastLines = stderr.split("\n").filter(Boolean).slice(-20).join("\n");
    throw new Error(lastLines ? `devcontainer up failed:\n${lastLines}` : `devcontainer up failed: ${execErr.message ?? "unknown error"}`);
  }
}

/** Execute a command via `devcontainer exec` (non-interactive). */
export function devcontainerExec(
  workspaceFolder: string,
  command: string[],
): string {
  const invocation = devcontainerInvocation([
    "exec",
    "--id-label",
    workspaceIdLabel(workspaceFolder),
    "--",
    ...command,
  ]);

  if (IS_WIN) {
    return execSync(buildWinCmd(invocation.bin, invocation.args), {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["pipe", "pipe", "inherit"],
    });
  }

  return execFileSync(invocation.bin, invocation.args, {
    encoding: "utf-8",
    timeout: 60000,
    stdio: ["pipe", "pipe", "inherit"],
  });
}

/** Execute a command via `devcontainer exec` (interactive). */
export function devcontainerExecInteractive(
  workspaceFolder: string,
  command: string[],
): Promise<number> {
  return new Promise((resolve, reject) => {
    const invocation = devcontainerInvocation([
      "exec",
      "--id-label",
      workspaceIdLabel(workspaceFolder),
      "--",
      ...command,
    ]);

    const child = IS_WIN
      ? spawn(buildWinCmd(invocation.bin, invocation.args), {
          stdio: "inherit",
          shell: true,
        })
      : spawn(invocation.bin, invocation.args, {
          stdio: "inherit",
        });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

// ─── Docker direct (down/status helpers) ────────────────────────────

/** Check if a container is running. */
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

/** Stop and remove a container. */
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

/** Find containers by inferred devcontainer workspace label. */
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

export interface LabeledContainer {
  containerId: string;
  status: string;
  workspaceFolder: string;
}

/** List all containers that have the devcontainer.local_folder label. */
export function listLabeledDevcontainers(): LabeledContainer[] {
  try {
    const result = execSync(
      "docker ps -a --filter \"label=devcontainer.local_folder\" --format \"{{.ID}}\\t{{.Status}}\\t{{.Label \\\"devcontainer.local_folder\\\"}}\"",
      { encoding: "utf-8", timeout: 10000, stdio: "pipe" }
    ).trim();

    if (!result) return [];

    return result
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [containerId, status, workspaceFolder] = line.split("\t");
        return {
          containerId,
          status,
          workspaceFolder,
        };
      });
  } catch {
    return [];
  }
}
